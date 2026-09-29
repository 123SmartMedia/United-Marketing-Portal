import { NextResponse } from 'next/server';

import { isAuthed } from '@/lib/adminAuth';
import { roomNow, addDays, monthKey, MAX_DAYS_AHEAD } from '@/lib/booking/rules';
import { listBookings, cancelBooking, getBookingStoreConfig } from '@/lib/booking/store';
import { sendCancellationNotice } from '@/lib/booking/emails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const unauthorized = () => NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

/** Months from today through the end of the booking window. */
function upcomingMonths() {
  const today = roomNow().date;
  const last = monthKey(addDays(today, MAX_DAYS_AHEAD));
  const months = [];
  for (let m = monthKey(today); m <= last; ) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return months;
}

// GET — every upcoming booking, with who booked it (admin only).
export async function GET(request) {
  if (!isAuthed(request.cookies)) return unauthorized();
  if (!getBookingStoreConfig().configured) {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }
  try {
    const today = roomNow().date;
    const bookings = (await listBookings(upcomingMonths())).filter((b) => b.date >= today);
    return NextResponse.json({ ok: true, bookings });
  } catch (err) {
    console.error('[booking] admin list failed', { code: err?.code });
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
}

// DELETE ?id=&date= — cancel a booking on someone's behalf and tell them.
export async function DELETE(request) {
  if (!isAuthed(request.cookies)) return unauthorized();
  const params = new URL(request.url).searchParams;
  const id = params.get('id') || '';
  const date = params.get('date') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }
  try {
    const cancelled = await cancelBooking(id, date);
    if (!cancelled) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    await sendCancellationNotice(cancelled).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[booking] admin cancel failed', { code: err?.code });
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
}
