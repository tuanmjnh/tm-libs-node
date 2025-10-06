import requestIp from 'request-ip';

// --- INTERFACES ---

/**
 * Minimal interface for the incoming Request object used by network utilities.
 */
export interface IncomingRequest {
  ip?: string; // IP set by the underlying framework (e.g., Express)
  protocol: string;
  originalUrl: string;
  headers: Record<string, any>;
  get: (header: string) => string | undefined;
  connection?: {
    remoteAddress?: string;
  };
  clientIP?: string | null; // Custom property set by clientIpMiddleware
  [key: string]: any; // Allows for flexibility with other request properties
}

// Minimal interfaces for standard middleware functions
type Response = any;
type NextFunction = () => void;

/**
 * Interface for the structured network information returned by getRequestInfo.
 */
export interface RequestInfo {
  ip: string;
  host: string;
  fullUrl: string;
  userAgent: string;
}

// --- INTERNAL HELPERS ---

/**
 * Normalizes an IP address string by handling common IPv6 formats.
 * - Removes the "::ffff:" prefix from IPv6-mapped IPv4 addresses.
 * - Maps "::1" (IPv6 loopback) to "127.0.0.1" (IPv4 loopback).
 * @param ip The raw IP address string, which may be null or undefined.
 * @returns The normalized IP address string, or null if the input was null/undefined.
 */
function normalizeIP(ip: string | null | undefined): string | null {
  if (!ip) return null;

  // Handle IPv6-mapped IPv4: "::ffff:192.0.2.1" -> "192.0.2.1"
  if (ip.startsWith('::ffff:')) {
    return ip.replace('::ffff:', '');
  }

  // Handle IPv6 loopback: "::1" -> "127.0.0.1"
  if (ip === '::1') {
    return '127.0.0.1';
  }

  return ip;
}

// --- EXPORTED UTILITIES ---

/**
 * Express/Koa middleware to detect the client's IP using request-ip and normalize it.
 * The normalized, proxy-aware IP is assigned to the request object as `req.clientIP`.
 */
export const clientIpMiddleware = (
  req: IncomingRequest,
  res: Response,
  next: NextFunction
) => {
  // request-ip automatically handles proxy headers (x-forwarded-for, x-real-ip)
  const rawIP = requestIp.getClientIp(req);

  // Assign the normalized IP to a custom request property
  req.clientIP = normalizeIP(rawIP);

  next();
};

/**
 * Retrieves the client's IP address.
 *
 * Priority is: 1. req.clientIP (set by middleware), 2. req.ip (set by framework), 3. req.connection.remoteAddress.
 * The resulting IP is normalized and defaults to '127.0.0.1'.
 *
 * @param request The request object.
 * @returns The client's IP address as a string, defaulting to '127.0.0.1'.
 */
export const getClientIpFromRequest = (request: IncomingRequest): string => {
  // 1. Check for IP set by clientIpMiddleware (proxy-aware)
  if (request.clientIP) {
    return request.clientIP;
  }

  // 2. Fallback to framework IP or connection address
  const rawIP = request.ip || request.connection?.remoteAddress;

  // 3. Normalize and return (or use default fallback)
  const normalizedIp = normalizeIP(rawIP);

  return normalizedIp || '127.0.0.1';
};

/**
 * Constructs the base host URL (protocol + host).
 *
 * @param request The request object.
 * @returns The host URL (e.g., "http://localhost:3000" or "https://api.example.com").
 */
export const getHost = (request: IncomingRequest): string => {
  const host = request.get('host');
  if (host) {
    // Default protocol to http for localhost/non-secure or https otherwise
    const protocol = request.protocol || (host.startsWith('localhost') ? 'http' : 'https');
    return `${protocol}://${host}`;
  }
  return 'http://127.0.0.1';
};

/**
 * Retrieves the User-Agent string from the request headers.
 *
 * @param request The request object.
 * @returns The User-Agent string or 'undefined' if not found.
 */
export const getUserAgent = (request: IncomingRequest): string => {
  // Use the standard request.get() method provided by Express/Koa
  const userAgent = request.get('user-agent');
  return userAgent || 'undefined';
};

/**
 * Gathers and normalizes all primary network information from the request object.
 * This is the unified function that combines IP, Host, Full URL, and User Agent retrieval.
 *
 * @param request The request object.
 * @returns A RequestInfo object containing structured network data.
 */
export const getRequestInfo = (request: IncomingRequest): RequestInfo => {

  // Reuse core logic for clean extraction
  const ip = getClientIpFromRequest(request);
  const host = getHost(request);
  const userAgent = getUserAgent(request);

  // Calculate the full URL
  // request.originalUrl typically starts with '/'
  const fullUrl = `${host}${request.originalUrl}`;

  return {
    ip,
    host,
    fullUrl,
    userAgent,
  };
};

/**
 * Constructs the full URL (protocol + host + original path/query).
 * NOTE: This is kept as a separate utility for backward compatibility 
 * but is also used internally by getRequestInfo.
 *
 * @param request The request object.
 * @returns The full URL (e.g., "http://example.com/api/users?id=1").
 */
export const getHostUrl = (request: IncomingRequest): string => {
  const hostBase = getHost(request);
  return `${hostBase}${request.originalUrl}`;
};

// Re-export requestIp for direct access if needed
export { requestIp };