import os from "os";
import https from "https";

export function getLocalIP(): string {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]!) {
        if (net.family === "IPv4" && !net.internal) {
          return net.address; // For example: 192.168.1.5
        }
      }
    }
    return "127.0.0.1"; // fallback
  } catch (error) {
    console.log(error)
    return "127.0.0.1"; // fallback
  }
}

export function getPublicIP(): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      https
        .get("https://api.ipify.org?format=json", (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const ip = JSON.parse(data).ip;
              resolve(ip); // For example: 115.74.xxx.xxx
            } catch (err) {
              reject(err);
            }
          });
        })
        .on("error", reject);
    } catch (error) {
      resolve('');
    }
  });
}

export async function getIPs() {
  const local = getLocalIP();
  let pub = "unknown";
  try {
    pub = await getPublicIP();
  } catch (e) {
    console.error("Failed to fetch public IP:", e);
  }
  return { local, public: pub };
}

// ---- For example use ----
// getIPs().then((ips) => {
//   console.log("Local IP:", ips.local);
//   console.log("Public IP:", ips.public);
// });
