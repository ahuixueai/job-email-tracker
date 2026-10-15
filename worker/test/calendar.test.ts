import { describe, expect, it } from "vitest";
import { handleApi } from "../src/api.js";
import { calendarToken, handleCalendar } from "../src/calendar.js";
import { handleIncoming } from "../src/inbox.js";
import type { IncomingMail } from "../src/inbox.js";
import type { Env } from "../src/types.js";
import { fakeDb } from "./fakeDb.js";

const ME = "me@gmail.example";
const NOW = Date.parse("2026-10-13T04:00:00Z");
const PASSWORD = "test-board-password";

function mail(id: string, subject: string, text: string): IncomingMail {
  return {
    envelopeFrom: "bounce@x.example",
    envelopeTo: "jobs@my.example",
    headers: [{ key: "x-forwarded-for", value: `${ME} jobs@my.example` }],
    from: "星河科技校园招聘 <campus@xinghe.example>",
    subject,
    text,
    html: undefined,
    date: "Mon, 12 Oct 2026 11:00:00 +0800",
    messageId: `<${id}@x>`,
  };
}

async function setup() {
  const fake = fakeDb();
  const env: Env = { DB: fake.db, ALLOWED_FORWARDERS: ME, BOARD_PASSWORD: PASSWORD, OWNER_EMAIL: "owner@example.com" };
  let n = 0;
  await handleIncoming(mail("a", "【星河科技】在线笔试通知", "考试时间：10月20日 19:00-20:40（北京时间）"), env, NOW, () => `id-${++n}`);
  await handleIncoming(mail("b", "【北辰】面试邀请", "面试时间：10月21日 14:00（北京时间）"), env, NOW, () => `id-${++n}`);
  return { ...fake, env };
}

describe("日历订阅", () => {
  it("口令不对：一律 404，不透露任何东西", async () => {
    const { env } = await setup();
    const bad = await handleCalendar(new Request(`https://board.example/cal/${"0".repeat(40)}.ics`), env, NOW);
    expect(bad.status).toBe(404);
    const junk = await handleCalendar(new Request("https://board.example/cal/abc.ics"), env, NOW);
    expect(junk.status).toBe(404);
  });

  it("口令对：返回日程里有时刻的事；删掉的信不再出现；升级前的旧链接（由密码算出的）照常能用", async () => {
    const { env, settings } = await setup();
    const token = await calendarToken(PASSWORD);
    const res = await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), env, NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART:20261020T110000Z");
    expect(ics).toContain("DTSTART:20261021T060000Z");
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(3);

    settings.set("edits", { value: JSON.stringify({ version: 1, deletedEmails: { "id-1": 1 } }), updated_at: "x" });
    const after = await (await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), env, NOW)).text();
    expect(after).not.toContain("DTSTART:20261020T110000Z");
    expect(after).toContain("DTSTART:20261021T060000Z");

    // 日历口令和登录密码已经脱钩：改密码不影响已订阅的日历
    const changed = await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), { ...env, BOARD_PASSWORD: "new-password" }, NOW);
    expect(changed.status).toBe(200);
  });

  it("换一个新链接：新链接能用，旧链接立刻 404", async () => {
    const { env } = await setup();
    const login = await handleApi(new Request("https://board.example/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { "cf-connecting-ip": "1.1.1.1" } }), env, NOW);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const old = await calendarToken(PASSWORD);
    const res = await handleApi(new Request("https://board.example/api/calendar/reset", { method: "POST", headers: { cookie } }), env, NOW);
    const { url } = (await res.json()) as { url: string };
    expect(url).not.toContain(old);
    expect((await handleCalendar(new Request(url), env, NOW)).status).toBe(200);
    expect((await handleCalendar(new Request(`https://board.example/cal/${old}.ics`), env, NOW)).status).toBe(404);
  });

  it("看板里拿到的订阅链接就是这个口令", async () => {
    const { env } = await setup();
    const login = await handleApi(new Request("https://board.example/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { "cf-connecting-ip": "1.1.1.1" } }), env, NOW);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const res = await handleApi(new Request("https://board.example/api/calendar", { headers: { cookie } }), env, NOW);
    const { url } = (await res.json()) as { url: string };
    expect(url).toBe(`https://board.example/cal/${await calendarToken(PASSWORD)}.ics`);
  });

  it("提醒提前量：设置里改了，日历跟着变；乱填的值存不进去", async () => {
    const { env } = await setup();
    const login = await handleApi(new Request("https://board.example/api/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { "cf-connecting-ip": "1.1.1.1" } }), env, NOW);
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
    const token = await calendarToken(PASSWORD);
    const ics = async () => (await handleCalendar(new Request(`https://board.example/cal/${token}.ics`), env, NOW)).text();
    expect(await ics()).toContain("TRIGGER:-PT1H");

    const put = (body: unknown) =>
      handleApi(new Request("https://board.example/api/prefs", { method: "PUT", headers: { cookie }, body: JSON.stringify(body) }), env, NOW);
    const saved = (await (await put({ calendar: { fixedAlarm: 30, deadlineAlarm: null } })).json()) as { prefs: unknown };
    expect(saved.prefs).toEqual({ version: 1, calendar: { fixedAlarm: 30, deadlineAlarm: null } });
    const after = await ics();
    expect(after).toContain("TRIGGER:-PT30M");
    expect(after).not.toContain("TRIGGER:-PT1H");

    await put({ calendar: { fixedAlarm: 7, deadlineAlarm: "x" } });
    const got = (await (await handleApi(new Request("https://board.example/api/prefs", { headers: { cookie } }), env, NOW)).json()) as { prefs: unknown };
    expect(got.prefs).toEqual({ version: 1, calendar: { fixedAlarm: 30, deadlineAlarm: null } });
    expect((await handleApi(new Request("https://board.example/api/prefs"), env, NOW)).status).toBe(401);
  });
});
