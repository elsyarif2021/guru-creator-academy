import { serveProtected } from '../server/protected.js';

export default function handler(req, res) {
  return serveProtected(req, res, true);
}
