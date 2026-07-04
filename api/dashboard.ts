import { getDashboardStats } from '../server/db';

// Vercel serverless endpoint for dashboard stats
export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const stats = getDashboardStats();
    return res.status(200).json(stats);
  } catch (error: any) {
    console.error('Dashboard Endpoint Error:', error.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
