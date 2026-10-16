import test from "node:test";
import assert from "node:assert/strict";
import { getScheduledEventStatus } from "../utils/scheduledEventStatus.js";

const eventDate = "2026-10-16";

test("starts an event at the scheduled Philippine-time start", () => {
  const event = { date: eventDate, time: "15:00", status: "upcoming" };

  assert.equal(
    getScheduledEventStatus(event, new Date("2026-10-16T06:59:59Z")),
    "upcoming"
  );
  assert.equal(
    getScheduledEventStatus(event, new Date("2026-10-16T07:00:00Z")),
    "ongoing"
  );
});

test("completes an event at its scheduled Philippine-time end", () => {
  const event = { date: eventDate, time: "15:00", endTime: "17:00", status: "ongoing" };

  assert.equal(
    getScheduledEventStatus(event, new Date("2026-10-16T08:59:59Z")),
    "ongoing"
  );
  assert.equal(
    getScheduledEventStatus(event, new Date("2026-10-16T09:00:00Z")),
    "completed"
  );
});

test("does not automatically change cancelled or manually overridden events", () => {
  const now = new Date("2026-10-16T07:00:00Z");

  assert.equal(
    getScheduledEventStatus({ date: eventDate, status: "cancelled" }, now),
    "cancelled"
  );
  assert.equal(
    getScheduledEventStatus({ date: eventDate, time: "15:00", status: "completed", statusManuallySet: true }, now),
    "completed"
  );
  assert.equal(
    getScheduledEventStatus({ date: eventDate, time: "15:00", status: "ongoing", statusManuallySet: true }, now),
    "ongoing"
  );
});

test("starts upcoming events on schedule even if their status was manually set", () => {
  assert.equal(
    getScheduledEventStatus({
      date: eventDate,
      time: "15:00",
      status: "upcoming",
      statusManuallySet: true,
    }, new Date("2026-10-16T07:00:00Z")),
    "ongoing"
  );
});

test("leaves status unchanged for invalid schedule dates", () => {
  assert.equal(
    getScheduledEventStatus({ date: "not-a-date", time: "15:00", status: "upcoming" }),
    "upcoming"
  );
});
