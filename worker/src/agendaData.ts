import type { AgendaItem } from "../../web/lib/demo/agenda";
import type { BoardPrefs } from "../../web/lib/demo/boardPrefs";
import { toLiveData } from "../../web/lib/demo/liveData";
import type { EmailRow } from "../../web/lib/demo/liveData";
import { EMPTY_EDITS, parseEdits } from "../../web/lib/demo/userEdits";
import { buildAgendaData } from "../../web/lib/demo/view";
import { getUserSetting, loadPrefs } from "./store.js";
import type { Env } from "./types.js";

/**
 * 服务端算一个人的日程：和看板「日程」用的是同一个函数（web/lib/demo/view.ts），不会两边对不上。
 * 日历订阅、邮件提醒都用它。只用绝对时刻（UTC），所以「看的人时区」随便给一个，不影响结果。
 */
export async function loadAgenda(env: Env, userId: string): Promise<{ agenda: AgendaItem[]; prefs: BoardPrefs }> {
  const [rows, editsValue, prefs] = await Promise.all([
    env.DB.prepare(
      "SELECT id, received_at, stored_at, via, from_addr, subject, body, status, outcome, model, error FROM emails WHERE user_id = ? ORDER BY received_at DESC LIMIT 1000",
    )
      .bind(userId)
      .all<EmailRow>(),
    getUserSetting(env, userId, "edits"),
    loadPrefs(env, userId),
  ]);
  let editsJson: unknown = null;
  try {
    editsJson = editsValue === null ? null : JSON.parse(editsValue);
  } catch {
    editsJson = null;
  }
  const edits = editsJson !== null ? parseEdits(editsJson) : EMPTY_EDITS;
  const live = toLiveData(rows.results, "UTC");
  const { agenda } = buildAgendaData(live.samples, live.results, edits, "UTC");
  return { agenda, prefs };
}
