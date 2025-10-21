import crypto from "crypto";
import bcrypt from "bcrypt";

export const SECRET = "48955e33-5871-3982-3c1e-e127e7714958";

export const MD5Hash = (val: string, secret?: string) =>
  crypto.createHash("md5").update(val + (secret || "")).digest("hex");

export const SHA256 = (val: string) =>
  crypto.createHash("sha256").update(val).digest("hex");

export const Base64Encode = (str: string) =>
  Buffer.from(str, "utf8").toString("base64");

export const Base64Decode = (str: string) =>
  Buffer.from(str, "base64").toString("utf8");

export const NewGuid = (n?: boolean) => {
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(-4);
  return n
    ? `${s4()}${s4()}${s4()}${s4()}${s4()}${s4()}${s4()}${s4()}`
    : `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
};

export const NewToken = () => crypto.randomBytes(64).toString("hex");

export const createPassword = async (password: string, salt?: string, lengthSalt?: number) => {
  salt = salt || await bcrypt.genSalt(lengthSalt || 10);
  const hashed = await bcrypt.hash(password, salt);
  return { password: hashed, salt };
};
