export function getScheduledEventStatus(event, now = new Date()) {
  if (!event.date || event.status === "cancelled" || event.statusManuallySet) {
    return event.status;
  }

  const startDate = new Date(`${event.date}T${event.time || "00:00"}:00+08:00`);
  if (Number.isNaN(startDate.getTime())) return event.status;

  if (event.endTime) {
    const endDate = new Date(`${event.date}T${event.endTime}:00+08:00`);
    if (!Number.isNaN(endDate.getTime()) && now >= endDate) return "completed";
  }

  return now >= startDate ? "ongoing" : "upcoming";
}
