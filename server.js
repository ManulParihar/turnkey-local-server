// Load environment variables from .env file
require('dotenv').config();
const express = require('express');
const { Turnkey } = require('@turnkey/sdk-server');

const { DEFAULT_ETHEREUM_ACCOUNTS } = require('./constants');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

const TURNKEY_PARENT_ORG_ID = process.env.TURNKEY_PARENT_ORG_ID;
const TURNKEY_API_URL = process.env.TURNKEY_API_URL;
const TURNKEY_API_PUBLIC_KEY = process.env.TURNKEY_API_PUBLIC_KEY;
const TURNKEY_API_PRIVATE_KEY = process.env.TURNKEY_API_PRIVATE_KEY;

const turnkeyConfig = {
    apiBaseUrl: TURNKEY_API_URL,
    defaultOrganizationId: TURNKEY_PARENT_ORG_ID,
    apiPublicKey: TURNKEY_API_PUBLIC_KEY,
    apiPrivateKey: TURNKEY_API_PRIVATE_KEY,
};
console.log("turnkeyConfig: ", turnkeyConfig);

if (!TURNKEY_PARENT_ORG_ID || !TURNKEY_API_URL || !turnkeyConfig.apiPublicKey || !turnkeyConfig.apiPrivateKey) {
    console.error("FATAL ERROR: Turnkey API keys or IDs are missing. Check your .env configuration.");
    process.exit(1);
}

const turnkey = new Turnkey(turnkeyConfig).apiClient();
console.log("Turnkey client initialized successfully.");

/**
 * Endpoint: POST /api/init-otp-auth
 * Initiates OTP authentication for an existing user's organization.
 */
app.post('/api/init-email-otp-auth', async (req, res) => {
    console.log("/api/init-email-otp-auth");
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }

    try {
        let organizationId = TURNKEY_PARENT_ORG_ID;

        // 1. Check if sub-organization exists for this email
        const { organizationIds } = await turnkey.getSubOrgIds({
            filterType: "EMAIL",
            filterValue: email,
        });

        if (organizationIds.length > 0) {
            organizationId = organizationIds[0];
        } else {
            console.error(`User organization not found for email: ${email}`);
            return res.status(404).json({ error: "User organization not found. Please register first." });
        }

        // 2. Initiate OTP auth
        const result = await turnkey.initOtpAuth({
            organizationId,
            otpType: "OTP_TYPE_EMAIL",
            contact: email,
        });
        console.log("result: ", result);
        console.log("organizationId: ", organizationId);

        res.json({ result, organizationId });
    } catch (error) {
        console.error("Error during handleInitOtpAuth:", error.message);
        res.status(500).json({ error: 'Failed to initialize OTP auth.' });
    }
});

/**
 * Endpoint: POST /api/otp-auth
 * Completes the OTP authentication flow.
 */
app.post('/api/otp-auth', async (req, res) => {
    console.log("/api/otp-auth");
    const {
        otpId,
        otpCode,
        organizationId,
        targetPublicKey,
        expirationSeconds,
        invalidateExisting,
    } = req.body;

    // Basic validation
    if (!otpId || !otpCode || !organizationId) {
        return res.status(400).json({ error: "Missing required parameters for OTP auth." });
    }

    try {
        const result = await turnkey.otpAuth({
            otpId,
            otpCode,
            organizationId,
            targetPublicKey,
            expirationSeconds,
            invalidateExisting,
        });
        console.log("OTP Auth Result: ", JSON.stringify(result, null, 2));

        res.json(result.credentialBundle);
    } catch (error) {
        console.error("Error during otpAuth:", error.message);
        res.status(500).json({ error: 'OTP authentication failed.', details: error.message });
    }
});

/**
 * Endpoint: POST /api/create-sub-organization
 * Creates a new sub-organization, user, and wallet.
 */
app.post('/api/create-sub-organization', async (req, res) => {
    console.log("/api/create-sub-organization");
    const { user, passkey, apiKeys } = req.body;

    console.log("user: ", user);
    console.log("passkey: ", passkey);
    console.log("apiKeys: ", apiKeys);

    if (!user || !user.userId || !passkey) {
        return res.status(400).json({ error: 'Missing authenticator parameters or user details.' });
    }

    try {
        const authenticators = {
            authenticatorName: "Passkey",
            challenge: passkey.challenge,
            attestation: passkey.attestation,
        };
        console.log("authenticators: ", authenticators);

        const subOrgResponse = await turnkey.createSubOrganization({
            organizationId: TURNKEY_PARENT_ORG_ID,
            subOrganizationName: `Sub-organization - ${user.userId} ${String(Date.now())}`,
            rootQuorumThreshold: 1,
            rootUsers: [
                {
                    userName: "Kokio User " + user.userId,
                    userEmail: user.email ?? "",
                    apiKeys: apiKeys ?? [],
                    authenticators: [authenticators],
                    oauthProviders: [],
                },
            ],
            wallet: {
                walletName: "ETH wallet",
                accounts: DEFAULT_ETHEREUM_ACCOUNTS,
            },
        });

        console.log("subOrgResponse: ", JSON.stringify(subOrgResponse, null, 2));

        res.json({
            ...subOrgResponse,
        });

    } catch (error) {
        console.error("Error during createSubOrganization:", error.message);
        res.status(500).json({ error: 'Failed to create sub-organization.', details: error.message });
    }
});

/**
 * Endpoint: POST /api/check-email
 * Checks if a sub-organization associated with an email already exists.
 */
app.post('/api/check-email', async (req, res) => {
    console.log("/api/check-email");
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }

    try {
        const { organizationIds } = await turnkey.getSubOrgIds({
            filterType: "EMAIL",
            filterValue: email,
        });

        const inUse = organizationIds.length > 0;
        const result = {
            inUse,
            organizationIds: inUse ? organizationIds : []
        };

        console.log(`Email check for ${email}: ${inUse}`);
        res.json(result);
    } catch (error) {
        console.error("Error during checkIfEmailInUse:", error.message);
        res.status(500).json({ error: 'Failed to check email availability.' });
    }
});

// --- SERVER STARTUP ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log("-----------------------------------------");
});
