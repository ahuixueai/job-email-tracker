import { DetailButton, KindChip } from "@/components/demo/EventCard";
import { DESTINATION_LABEL, timeSummary } from "@/lib/demo/parseDemo";
import type { DemoResult } from "@/lib/demo/parseDemo";
import type { SampleEmail } from "@/lib/demo/sampleEmails";

/**
 * 「邮件」视图：一封一行。和日程卡一样只突出公司、岗位、时间；
 * 原文与判断依据在「详情」里。
 *
 * 与「日程」的区别：这里是**逐封**的——催办和原通知各占一行，被忽略的验证码也在；
 * 日程是合并之后的「一件事一条」。
 */
export function EmailView({
  samples,
  results,
  viewerTimeZone,
  onDetail,
}: {
  samples: readonly SampleEmail[];
  results: ReadonlyMap<string, DemoResult>;
  viewerTimeZone: string;
  onDetail: (sampleId: string) => void;
}) {
  return (
    <ul className="space-y-2" aria-label="邮件列表">
      {samples.map((sample) => {
        const result = results.get(sample.id);
        if (!result) return null;
        return (
          <li
            key={sample.id}
            data-email-row={sample.id}
            className="rounded-xl border border-hairline bg-surface px-4 py-3"
          >
            {result.destination === "dropped" ? (
              <IgnoredRow sample={sample} onDetail={() => onDetail(sample.id)} />
            ) : (
              <ParsedRow
                sample={sample}
                result={result}
                viewerTimeZone={viewerTimeZone}
                onDetail={() => onDetail(sample.id)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ParsedRow({
  sample,
  result,
  viewerTimeZone,
  onDetail,
}: {
  sample: SampleEmail;
  result: DemoResult;
  viewerTimeZone: string;
  onDetail: () => void;
}) {
  const company = result.displayCompany.length > 0 ? result.displayCompany : "公司未认出";
  const time = timeSummary(result, viewerTimeZone);
  return (
    <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[1fr_auto_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <KindChip result={result} />
          {result.destination === "pending" ? (
            <span className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-on-accent">
              {DESTINATION_LABEL.pending}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-base font-semibold break-words text-ink">
          {company}
          <span className="font-normal text-ink-soft"> · {result.role ?? "岗位未写明"}</span>
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-faint">{sample.raw.subject}</p>
      </div>
      <p className="tabular text-sm font-semibold text-ink sm:text-right">
        {time.text}
        {time.zone ? <span className="block text-xs font-normal text-ink-faint">{time.zone}</span> : null}
      </p>
      <div className="flex justify-end">
        <DetailButton onClick={onDetail} label={`${company}的详情`} />
      </div>
    </div>
  );
}

function IgnoredRow({ sample, onDetail }: { sample: SampleEmail; onDetail: () => void }) {
  return (
    <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <span className="rounded-lg bg-raised px-2 py-1 text-xs text-ink-soft">
          {DESTINATION_LABEL.dropped}
        </span>
        <p className="mt-2 truncate text-sm text-ink-soft">{sample.raw.subject}</p>
      </div>
      <div className="flex justify-end">
        <DetailButton onClick={onDetail} label={`${sample.raw.subject}的详情`} />
      </div>
    </div>
  );
}
