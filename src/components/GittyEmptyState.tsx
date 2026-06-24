type GittyEmptyStateProps = {
  projectName: string;
};

export function GittyEmptyState({ projectName }: GittyEmptyStateProps) {
  return (
    <div className="gitty-empty-state">
      <div className="gitty-empty-content">
        <img
          className="gitty-mascot"
          src="/gitty-sad.png"
          alt=""
          width={120}
          height={120}
          draggable={false}
        />
        <div className="gitty-speech-bubble">
          <p>
            Gitty is sad, there&apos;s no changes for{" "}
            <strong>{projectName}</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
