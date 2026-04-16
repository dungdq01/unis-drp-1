/**
 * Shared date utilities — dùng bởi M22 (period_date), M23 (weekStart matching).
 * Rule: period_date luôn = Monday của tuần áp dụng (spec M22 §6b).
 */

/**
 * Trả về ngày Monday của tuần chứa `date` (UTC).
 * Sun → lùi 6 ngày; Mon → giữ nguyên; Tue-Sat → lùi N ngày về Mon.
 */
export function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, 2=Tue … 6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** ISO 'YYYY-MM-DD' string của Monday của tuần chứa `date`. */
export function mondayOfStr(date: Date): string {
  return mondayOf(date).toISOString().slice(0, 10);
}

/**
 * Giờ hiện tại theo Asia/Ho_Chi_Minh (UTC+7) dạng HH:MM.
 * Dùng để check cutoff — không cần timezone lib.
 */
export function currentTimeVN(): string {
  const vnDate = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const h = String(vnDate.getUTCHours()).padStart(2, '0');
  const m = String(vnDate.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Check xem giờ VN hiện tại đã vượt cutoff chưa.
 * @param cutoff e.g. "18:00"
 */
export function isPastCutoffVN(cutoff: string): boolean {
  return currentTimeVN() >= cutoff;
}

/**
 * Số ms đến lần kích hoạt tiếp theo tại giờ VN targetVN ("HH:MM").
 * Dùng cho setTimeout-based cron trong M25/M26 (thay thế private _msUntilVN).
 * Pattern: Date.UTC với offset -7h để tránh bug sub-zero hour (BUG-M23-2).
 */
export function msUntilVN(targetVN: string): number {
  const [hh, mm] = targetVN.split(':').map(Number);
  const nowMs = Date.now();
  const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000);
  const fire = new Date(Date.UTC(
    vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(),
    hh - 7, mm, 0, 0,
  ));
  if (fire.getTime() <= nowMs) fire.setUTCDate(fire.getUTCDate() + 1);
  return fire.getTime() - nowMs;
}
