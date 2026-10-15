import { Router } from 'express';
import { requireAuth, AuthRequest } from '../middlewares/auth';
import { brazilToday, holidaysBetween } from '../../shared/holidays';
import { validDate } from '../../shared/dates';
import { holidaySummaryFor } from '../services/holidays';
import { asyncHandler } from '../utils/asyncHandler';
const router = Router();
router.use(requireAuth);
router.get('/', (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!validDate(startDate) || !validDate(endDate)) return res.status(400).json({ error: 'Informe datas válidas.' });
    return res.json(holidaysBetween(startDate, endDate));
  } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
});
router.get('/summary', asyncHandler(async (req: AuthRequest, res) => {
  const date = req.query.date ?? brazilToday();
  if (!validDate(date) || Number(date.slice(0, 4)) < 1900 || Number(date.slice(0, 4)) > 9997) return res.status(400).json({ error: 'Data inválida.' });
  res.json(await holidaySummaryFor(req.user!, date));
}));
export default router;
