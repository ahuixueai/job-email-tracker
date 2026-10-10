import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  extractSenderDomain,
  MAX_BODY_CHARS,
  rawHashOf,
  stripQuoted,
  toCleanEmail,
} from "../src/rawEmail.js";

describe("extractSenderDomain", () => {
  it("从带显示名的地址里取域名", () => {
    expect(extractSenderDomain("Moka <no-reply@mail.mokahr.com>")).toBe("mail.mokahr.com");
  });

  it("裸地址也能取", () => {
    expect(extractSenderDomain("campus@jd.com")).toBe("jd.com");
  });

  it("大小写归一", () => {
    expect(extractSenderDomain("HR@Nowcoder.COM")).toBe("nowcoder.com");
  });

  it("取不到时返回空串而不是抛异常", () => {
    expect(extractSenderDomain("not-an-address")).toBe("");
    expect(extractSenderDomain("")).toBe("");
  });
});

describe("stripQuoted", () => {
  it("剥掉中文转发分隔线之后的全部内容", () => {
    const body = "面试时间调整为 8月20日 14:00\n------ 原始邮件 ------\n原定 8月18日 10:00";
    expect(stripQuoted(body)).not.toContain("8月18日");
    expect(stripQuoted(body)).toContain("8月20日");
  });

  it("剥掉英文 On ... wrote: 之后的内容", () => {
    const body = "Rescheduled to Aug 20.\nOn Mon, Aug 11, 2026 at 9:00 AM HR wrote:\nAug 18 10:00";
    expect(stripQuoted(body)).not.toContain("Aug 18");
  });

  it("剥掉行首 > 引用行", () => {
    expect(stripQuoted("新内容\n> 旧内容\n>> 更旧")).toBe("新内容");
  });

  it("不误伤正文里非行首的 >", () => {
    expect(stripQuoted("匹配度 > 80% 建议投递")).toContain("> 80%");
  });
});

describe("collapseWhitespace", () => {
  it("折叠多余空格与空行", () => {
    expect(collapseWhitespace("a   b\n\n\n\nc  \n  d")).toBe("a b\n\nc\nd");
  });
});

describe("rawHashOf", () => {
  it("同内容同指纹，不同内容不同指纹", () => {
    expect(rawHashOf("京东笔试通知")).toBe(rawHashOf("京东笔试通知"));
    expect(rawHashOf("京东笔试通知")).not.toBe(rawHashOf("京东笔试通知 "));
  });

  it("定长十六进制，便于建索引", () => {
    expect(rawHashOf("")).toMatch(/^[0-9a-f]{16}$/);
    expect(rawHashOf("很长很长的邮件正文".repeat(500))).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("toCleanEmail", () => {
  const base = {
    id: "mail-1",
    from: "Moka <no-reply@mail.mokahr.com>",
    to: "u_abcdef@inbox.example.com",
    receivedAtUtc: "2026-08-11T13:34:00.000Z",
  };

  it("全角数字与冒号折半，主题正文都处理", () => {
    const clean = toCleanEmail({ ...base, subject: "８月１５日面试", body: "１０：００ 开始" });
    expect(clean.subject).toBe("8月15日面试");
    expect(clean.body).toBe("10:00 开始");
    expect(clean.text).toBe("8月15日面试 10:00 开始");
  });

  it("超长正文截断并置 truncated", () => {
    const clean = toCleanEmail({ ...base, subject: "s", body: "字".repeat(MAX_BODY_CHARS + 10) });
    expect(clean.truncated).toBe(true);
    expect(clean.body).toHaveLength(MAX_BODY_CHARS);
  });

  it("正常长度不置 truncated", () => {
    expect(toCleanEmail({ ...base, subject: "s", body: "短正文" }).truncated).toBe(false);
  });

  it("同一封信重复转发时 rawHash 相同", () => {
    const a = toCleanEmail({ ...base, id: "mail-1", subject: "京东笔试", body: "8月15日 10:00" });
    const b = toCleanEmail({ ...base, id: "mail-2", subject: "京东笔试", body: "8月15日 10:00" });
    expect(a.rawHash).toBe(b.rawHash);
    expect(a.id).not.toBe(b.id);
  });
});
