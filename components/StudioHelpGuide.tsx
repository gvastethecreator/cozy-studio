import { CozyMascot } from './CozyMascot';

export function StudioHelpGuide() {
  return (
    <section className="studio-help-guide" aria-label="Getting started with Studio" tabIndex={-1}>
      <div className="studio-help-intro">
        <CozyMascot state="welcome" />
        <div>
          <h3 className="text-xl font-semibold">Getting started</h3>
          <p className="studio-muted">From an idea to a result you can find again.</p>
        </div>
      </div>
      <ol className="settings-form-stack">
        <li>
          <strong>1. Choose a workflow</strong>
          <p>
            Use Default for a new image or edit. Choose a specialized workflow for characters,
            camera views or sequences.
          </p>
        </li>
        <li>
          <strong>2. Add your references</strong>
          <p>
            Attach a source image and describe what should change. Workspaces keep references
            together while each workflow remembers its controls.
          </p>
        </li>
        <li>
          <strong>3. Set the output</strong>
          <p>
            Choose size and background. Remove background requests transparency when supported. PNG
            keeps soft edges; GIF transparency is binary.
          </p>
        </li>
        <li>
          <strong>4. Find and reuse results</strong>
          <p>
            Open workspace history or the library. Restore a result’s settings to continue. Settings
            → Files &amp; naming shows where new files go and how they are named.
          </p>
        </li>
      </ol>
    </section>
  );
}
