export function localDay(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// A UTC envelope includes both local month boundaries, including DST changes.
// The exact business calendar day is checked below, independently of server TZ.
export function monthEnvelope(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    year, monthNumber,
    from: new Date(Date.UTC(year, monthNumber - 1, -1)),
    until: new Date(Date.UTC(year, monthNumber, 3)),
  };
}

interface MetricSession {
  occurredAt: Date;
  clientId: string;
  amount: { toString(): string } | null;
}

export function attentionMetrics(sessions: MetricSession[], now: Date, timezone: string, selectedMonth?: string) {
  const today = localDay(now, timezone);
  const month = selectedMonth ?? today.slice(0, 7);
  const period = monthEnvelope(month);
  const days = new Date(Date.UTC(period.year, period.monthNumber, 0)).getUTCDate();
  const daily = Array.from({ length: days }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, '0')}`, count: 0,
  }));
  const clients = new Set<string>();
  let monthCount = 0, todayCount = 0, revenueCents = 0, missingAmountCount = 0;
  for (const session of sessions) {
    const day = localDay(session.occurredAt, timezone);
    if (day.slice(0, 7) !== month || session.occurredAt > now) continue;
    monthCount++;
    if (day === today) todayCount++;
    daily[Number(day.slice(-2)) - 1].count++;
    clients.add(session.clientId);
    if (session.amount == null) missingAmountCount++;
    else revenueCents += Math.round(Number(session.amount.toString()) * 100);
  }
  return { month, timezone, todayCount, monthCount,
    uniqueClients: clients.size, revenue: revenueCents / 100, missingAmountCount, daily };
}
