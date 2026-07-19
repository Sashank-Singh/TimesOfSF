import { jobsForDesk } from "../content/monetization";

type Props = {
  desk: string;
};

export function JobsBoard({ desk }: Props) {
  const jobs = jobsForDesk(desk);
  if (jobs.length === 0) return null;

  return (
    <aside className="mt-12 border-t border-ink/10 pt-8" aria-labelledby="sf-jobs-heading">
      <h2 id="sf-jobs-heading" className="text-[10px] font-mono uppercase tracking-[0.25em] text-ink/40 mb-4">
        SF hiring
      </h2>
      <ul className="space-y-4">
        {jobs.map((job) => (
          <li key={job.id}>
            <a
              href={job.href}
              className="block group"
              rel={job.href.startsWith("http") ? "sponsored noopener noreferrer" : undefined}
              target={job.href.startsWith("http") ? "_blank" : undefined}
            >
              <p className="text-sm font-bold group-hover:text-accent transition-colors">{job.title}</p>
              <p className="text-xs text-ink/55 mt-1">
                {job.company} · {job.location}
              </p>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
