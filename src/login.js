import { startDeviceAuthorization, pollDeviceToken, saveCredentials, credentialsPath } from "./auth.js";
import { refreshClineToken } from "./cline-auth-api.js";

export async function login({ onPrompt = defaultPrompt, fetchImpl = fetch } = {}) {
	const auth = await startDeviceAuthorization();
	await onPrompt({
		userCode: auth.userCode,
		verificationUri: auth.verificationUri,
		verificationUriComplete: auth.verificationUriComplete,
		expiresIn: auth.expiresIn,
	});

	const tokens = await pollDeviceToken(auth);
	const data = await refreshClineToken(tokens.refreshToken, { fetchImpl });
	const creds = {
		provider: "cline",
		accessToken: data.accessToken,
		refreshToken: data.refreshToken ?? tokens.refreshToken,
		expiresAt: data.expiresAt,
		tokenType: data.tokenType ?? "Bearer",
		userInfo: data.userInfo,
		createdAt: new Date().toISOString(),
	};
	const file = await saveCredentials(creds);
	return { file, userInfo: data.userInfo };
}

function defaultPrompt({ userCode, verificationUriComplete, verificationUri, expiresIn }) {
	console.log("\nOpen this URL in a browser to authorize:\n");
	console.log(`  ${verificationUriComplete ?? verificationUri}\n`);
	console.log(`Code: ${userCode}   (expires in ${Math.round(expiresIn / 60)} min)\n`);
	console.log("Waiting for authorization...");
}

export async function loginAndReport(opts) {
	const { file, userInfo } = await login(opts);
	const email = userInfo?.email ?? "unknown";
	console.log(`\nSigned in as ${email}`);
	console.log(`Credentials written to ${file}`);
	return { file, userInfo };
}

export { credentialsPath };
