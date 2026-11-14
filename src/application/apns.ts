/**
 * Agent codebase — module explanation / info.
 * File: src/application/apns.ts
 * Purpose: APNs alert sender — JWT-based HTTP/2 push to Apple Push Notification service; opt-in via APNS_* env vars. Ported from Bot (relay-beacon).
 */

import fs from "node:fs";
import path from "node:path";
import http2 from "node:http2";
import { createPrivateKey, createSign } from "node:crypto";

let cachedJwt: { value: string; issuedAt: number; keyId: string; teamId: string } | null = null;

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function apnsJwt(): string | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const keyPath = process.env.APNS_PRIVATE_KEY_PATH;
  if (!keyId || !teamId || !keyPath || !process.env.APNS_BUNDLE_ID) return null;
  if (!path.isAbsolute(keyPath)) throw new Error("APNS_PRIVATE_KEY_PATH must be an absolute path outside the repository.");

  const keyRoot = fs.realpathSync(process.cwd());
  const realKeyPath = fs.realpathSync(keyPath);
  const relativeKey = path.relative(keyRoot, realKeyPath);
  if (relativeKey === "" || (!relativeKey.startsWith(`..${path.sep}`) && relativeKey !== ".." && !path.isAbsolute(relativeKey))) {
    throw new Error("APNs private key must be stored outside the repository.");
  }
  const stat = fs.statSync(keyPath);
  if ((stat.mode & 0o077) !== 0) throw new Error("APNs private key file permissions must be 0600 or stricter.");

  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.keyId === keyId && cachedJwt.teamId === teamId && now - cachedJwt.issuedAt < 50 * 60) {
    return cachedJwt.value;
  }
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({ key: createPrivateKey(fs.readFileSync(keyPath)), dsaEncoding: "ieee-p1363" });
  const value = `${unsigned}.${base64url(signature)}`;
  cachedJwt = { value, issuedAt: now, keyId, teamId };
  return value;
}

export function apnsConfigured(): boolean {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY_PATH && process.env.APNS_BUNDLE_ID);
}

export function sendApnsAlert(deviceToken: string, title: string, body: string): Promise<{ configured: boolean; status: number | null }> {
  if (!apnsConfigured()) return Promise.resolve({ configured: false, status: null });
  const jwt = apnsJwt();
  if (!jwt) return Promise.resolve({ configured: false, status: null });
  const environment = process.env.APNS_ENVIRONMENT === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const client = http2.connect(`https://${environment}`);

  return new Promise<{ configured: true; status: number }>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, status = 0) => {
      if (settled) return;
      settled = true;
      client.close();
      if (error) reject(error);
      else resolve({ configured: true, status });
    };
    client.once("error", (error) => finish(error));
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": process.env.APNS_BUNDLE_ID!,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let status = 0;
    request.on("response", (headers) => { status = Number(headers[":status"] || 0); });
    request.on("data", () => { /* consume */ });
    request.on("error", (error) => finish(error));
    request.on("end", () => finish(undefined, status));
    request.setTimeout(8000, () => {
      request.close(http2.constants.NGHTTP2_CANCEL);
      finish(new Error("APNs request timed out"));
    });
    request.end(JSON.stringify({ aps: { alert: { title: title.slice(0, 120), body: body.slice(0, 500) }, sound: "default" } }));
  });
}
