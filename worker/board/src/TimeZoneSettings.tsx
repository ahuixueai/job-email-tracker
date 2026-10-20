import { useState } from "react";
import { Section } from "@/components/demo/SettingsView";
import { HOME_ZONE_CHOICES, JOB_ZONE_CHOICES } from "@/lib/demo/boardPrefs";
import type { TimeZonePrefs } from "@/lib/demo/boardPrefs";
import { zoneLabel } from "@/lib/demo/parseDemo";

const select = "mt-1 w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink";

/** 「你在哪」的选项：跟随设备 + 常用地点；现在设的不在表里也列出来，免得显示成别的。 */
function homeOptions(deviceZone: string, current: string | null): { value: string; label: string }[] {
  const options = [{ value: "", label: `跟随这台设备（${zoneLabel(deviceZone)}）` }];
  for (const c of HOME_ZONE_CHOICES) options.push({ value: c.zone, label: c.label });
  if (current !== null && !HOME_ZONE_CHOICES.some((c) => c.zone === current)) options.push({ value: current, label: zoneLabel(current) });
  return options;
}

/** 设置页里一组的标题已经说了是什么，下拉框上就不再重复（showLabel = false）。 */
function HomeSelect({ value, deviceZone, onChange, showLabel = true }: { value: string | null; deviceZone: string; onChange: (zone: string | null) => void; showLabel?: boolean }) {
  return (
    <label className="block text-sm text-ink-soft">
      {showLabel ? "你现在在哪" : <span className="sr-only">你现在在哪</span>}
      <select name="homeZone" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)} className={select}>
        {homeOptions(deviceZone, value).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function JobSelect({ value, onChange, showLabel = true }: { value: string; onChange: (zone: string) => void; showLabel?: boolean }) {
  return (
    <label className="block text-sm text-ink-soft">
      {showLabel ? "你在哪里找工作" : <span className="sr-only">你在哪里找工作</span>}
      <select name="jobZone" value={value} onChange={(e) => onChange(e.target.value)} className={select}>
        {JOB_ZONE_CHOICES.map((c) => (
          <option key={c.zone} value={c.zone}>
            {c.label}（{c.clock}）
          </option>
        ))}
      </select>
    </label>
  );
}

const JOB_HINT = "招聘邮件没写时区时，按这里换算成你那里的时间，详情里会写明「按你设置的求职地」。信里写了别的时区（比如香港时间）的，照信里的算。";

/** 登录后第一次进来：请你选一次。选完才进看板，因为没写时区的信要靠它换算。 */
export function TimeZoneOnboarding({
  deviceZone,
  onSave,
}: {
  deviceZone: string;
  onSave: (zones: TimeZonePrefs) => Promise<void>;
}) {
  const [home, setHome] = useState<string | null>(null);
  const [job, setJob] = useState<string>(JOB_ZONE_CHOICES[0].zone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-16">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError(null);
          onSave({ home, job }).catch(() => {
            setError("没保存成功，检查一下网络再试");
            setBusy(false);
          });
        }}
        className="w-full max-w-sm rounded-card border border-hairline bg-surface p-6 shadow-card"
        data-onboarding
      >
        <h1 className="text-lg font-semibold text-ink">先设置一下时区</h1>
        <p className="mt-1 text-sm leading-relaxed text-ink-soft">看板上的时间都按你现在所在的时区显示，信里原来的时间在每条的详情里。以后可以在「设置 → 时区」里改。</p>
        <div className="mt-5 space-y-4">
          <HomeSelect value={home} deviceZone={deviceZone} onChange={setHome} />
          <div>
            <JobSelect value={job} onChange={setJob} />
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">{JOB_HINT}</p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-xs text-on-drop-soft">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          data-action="save-zones"
          className="mt-5 w-full rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-on-brand-soft hover:opacity-85 disabled:opacity-50"
        >
          {busy ? "保存中…" : "开始使用"}
        </button>
      </form>
    </div>
  );
}

/** 设置页「时区」一组。改求职地会按新设置重算已经收到的邮件。 */
export function TimeZoneSettings({
  zones,
  deviceZone,
  onSave,
  reparse,
}: {
  zones: TimeZonePrefs;
  deviceZone: string;
  onSave: (zones: TimeZonePrefs) => Promise<void>;
  /** 正在重算 / 刚重算完的一句话；没有为 null。 */
  reparse: string | null;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const save = (next: TimeZonePrefs) => {
    setState("saving");
    onSave(next).then(
      () => setState("saved"),
      () => setState("failed"),
    );
  };
  return (
    <>
      <Section title="你现在在哪" hint="看板上的时间都按这里显示。跟随设备时，你出门换了时区，看板也跟着换。">
        <div className="sm:w-80">
          <HomeSelect value={zones.home} deviceZone={deviceZone} onChange={(home) => save({ ...zones, home })} showLabel={false} />
        </div>
      </Section>
      <Section title="你在哪里找工作" hint={JOB_HINT}>
        <div className="sm:w-80">
          <JobSelect value={zones.job ?? JOB_ZONE_CHOICES[0].zone} onChange={(job) => save({ ...zones, job })} showLabel={false} />
        </div>
      </Section>
      {state !== "idle" || reparse !== null ? (
        <p role={state === "failed" ? "alert" : "status"} data-zone-status className={`text-xs ${state === "failed" ? "text-on-drop-soft" : "text-ink-soft"}`}>
          {state === "failed" ? "保存失败，刷新后再试一次" : (reparse ?? (state === "saving" ? "保存中…" : "已保存"))}
        </p>
      ) : null}
    </>
  );
}
