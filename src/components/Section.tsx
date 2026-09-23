export function Section({
  title,
  more,
  moreTo = "/explore",
  children,
}: {
  title: string;
  more?: string;
  moreTo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="section">
      <div className="section-head">
        <span className="section-title">{title}</span>
        {more && <a className="section-more" href={moreTo}>{more}</a>}
      </div>
      {children}
    </div>
  );
}
