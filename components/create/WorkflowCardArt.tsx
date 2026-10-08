import React from 'react';
import mascot from '../../assets/logo.svg';
import type { PreferredWorkflow } from '../../packages/shared/src/workflowCatalog';

const cup = (x: number, y: number, size: number, rotation = 0) => (
  <image
    href={mascot}
    x={x}
    y={y}
    width={size}
    height={size * 1.16}
    transform={`rotate(${rotation} ${x + size / 2} ${y + size / 2})`}
  />
);
const frame = (x: number, y: number, width: number, height: number) => (
  <rect
    x={x}
    y={y}
    width={width}
    height={height}
    rx="8"
    fill="#fffaf0"
    stroke="#c9bcaa"
    strokeWidth="2"
  />
);
const spark = (x: number, y: number) => (
  <path d={`M${x} ${y - 13}q0 13 13 13q-13 0-13 13q0-13-13-13q13 0 13-13Z`} fill="#d28a36" />
);

/** Small editorial scenes built from the canonical Cozy mascot, not generated examples. */
const WORKFLOW_CARDS: Record<PreferredWorkflow, { description: string; art: React.ReactNode }> = {
  default: {
    description: 'Turn a prompt and references into an image.',
    art: (
      <>
        {frame(54, 35, 212, 166)}
        <path d="M75 175h168" stroke="#ded3c1" strokeWidth="2" />
        {cup(113, 57, 92)}
        {spark(224, 73)}
        <path d="m230 160 30-31 9 9-31 30-13 5Z" fill="#d28a36" />
      </>
    ),
  },
  remaster: {
    description: 'Restore detail and refine an existing image.',
    art: (
      <>
        {frame(35, 45, 250, 150)}
        <g opacity=".35">
          {cup(61, 71, 83)}
          <path d="M45 112h106M45 137h106M80 53v134M113 53v134" stroke="#b8ab97" strokeWidth="3" />
        </g>
        <path d="M160 36v168" stroke="#d28a36" strokeWidth="3" />
        {cup(183, 71, 83)}
        {spark(263, 54)}
      </>
    ),
  },
  'character-poses': {
    description: 'Explore poses and expressions with the same identity.',
    art: (
      <>
        <path d="M42 185h236" stroke="#c9bcaa" strokeWidth="2" />
        {cup(34, 99, 65, -16)}
        {cup(125, 53, 70, 0)}
        {cup(221, 95, 60, 18)}
        <path
          d="m84 55 17-14m121 7 16 13M148 30v-9"
          stroke="#d28a36"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </>
    ),
  },
  'character-sprites': {
    description: 'Build a sprite action with a chosen frame count.',
    art: (
      <>
        {frame(26, 49, 268, 137)}
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            {cup(39 + i * 67, 70 - (i % 2) * 14, 43, i % 2 ? 10 : -10)}
            <rect x={39 + i * 67} y="157" width="42" height="5" rx="2" fill="#d28a36" />
          </g>
        ))}
        <path d="M84 59v117m67-117v117m67-117v117" stroke="#ded3c1" strokeDasharray="4 5" />
      </>
    ),
  },
  'character-scenes': {
    description: 'Place your character in a new environment.',
    art: (
      <>
        {frame(28, 30, 264, 180)}
        <circle cx="235" cy="70" r="20" fill="#edbc70" />
        <path d="m30 172  60 -56  50 45 50-67 101 78v36H30Z" fill="#b6c1a6" />
        {cup(122, 90, 80)}
      </>
    ),
  },
  'character-variants': {
    description: 'Try new outfits, equipment and character variants.',
    art: (
      <>
        {cup(35, 85, 60)}
        {cup(127, 85, 60)}
        {cup(219, 85, 60)}
        <path d="m 30 119 35-25  30 25Z" fill="#acb99c" />
        <path d="M125 126h65l-12-27h-30Z" fill="#c1957e" />
        <path d="m224 120 3-25 19 12 19-12 3 25Z" fill="#d7ae5f" />
        <path
          d="M 50 193h35m 50 0h35m 50 0h35"
          stroke="#c9bcaa"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </>
    ),
  },
  'character-transforms': {
    description: 'Change framing, lighting and the canvas.',
    art: (
      <>
        {frame(48, 35, 220, 170)}
        {cup(122, 58, 88)}
        <path
          d="M36 85V24h61m127 0h 60v61M36 157v61h61m127 0h 60v-61"
          fill="none"
          stroke="#d28a36"
          strokeWidth="4"
        />
        <circle cx="70" cy="68" r="18" fill="#edbc70" opacity=".65" />
      </>
    ),
  },
  character: {
    description: 'Create a consistent character reference sheet.',
    art: (
      <>
        {frame(34, 25, 252, 190)}
        {cup(55, 59, 82)}
        <path d="M155 42v153m18-73h94" stroke="#ded3c1" strokeWidth="2" />
        {cup(192, 43, 43)}
        <g transform="translate(447 0) scale(-1 1)">{cup(192, 134, 43)}</g>
        <path d="M 60 178h66m-66 10h45" stroke="#c9bcaa" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  'character-lab': {
    description: 'All character tools in one creative workspace.',
    art: (
      <>
        <circle
          cx="160"
          cy="120"
          r="82"
          fill="none"
          stroke="#c9bcaa"
          strokeWidth="2"
          strokeDasharray="5 7"
        />
        {cup(111, 61, 94)}
        {frame(24, 40, 50, 50)}
        {spark(49, 65)}
        {frame(245, 49, 50, 50)}
        <path d="m257 77 10-14 16 14" fill="none" stroke="#acb99c" strokeWidth="4" />
        {frame(235, 164, 50, 40)}
        <path d="M247 178h26m-26 10h18" stroke="#d28a36" strokeWidth="3" />
        {frame(32, 169, 50, 40)}
        <circle cx="57" cy="189" r="10" fill="#c1957e" />
      </>
    ),
  },
  camera: {
    description: 'Reframe a scene with camera and perspective controls.',
    art: (
      <>
        {cup(109, 50, 103)}
        <path
          d="M 40 83V 40h 50m140 0h 50v43M 40 157v43h 50m140 0h 50v-43"
          fill="none"
          stroke="#8f9e86"
          strokeWidth="4"
        />
        <path d="M147 120h26m-13-13v26" stroke="#d28a36" strokeWidth="2" />
        <circle cx="261" cy="59" r="5" fill="#d28a36" />
      </>
    ),
  },
  cinematic: {
    description: 'Compose a story as a series of cinematic shots.',
    art: (
      <>
        {frame(25, 48, 170, 130)}
        <path d="M29 65h162M29 161h162" stroke="#373532" strokeWidth="14" />
        {cup(77, 75, 60)}
        {frame(207, 48, 88, 60)}
        {cup(237, 58, 30)}
        {frame(207, 119, 88, 60)}
        {cup(218, 127, 30)}
        <path
          d="M 40 200h 90m12 0h 50m12 0h 50"
          stroke="#c9bcaa"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </>
    ),
  },
  timeline: {
    description: 'Arrange shots and shape their timing on a timeline.',
    art: (
      <>
        {frame(80, 25, 160, 128)}
        {cup(123, 43, 70)}
        <path d="M26 183h268m-268  30h268" stroke="#c9bcaa" strokeWidth="2" />
        <rect x="35" y="189" width="78" height="18" rx="4" fill="#b6c1a6" />
        <rect x="118" y="189" width="91" height="18" rx="4" fill="#edbc70" />
        <rect x="214" y="189" width="60" height="18" rx="4" fill="#c1957e" />
        <path d="M160 173v49m-6-49h12l-6 8Z" stroke="#373532" strokeWidth="2" />
      </>
    ),
  },
  'animation-sequence': {
    description: 'Generate connected frames and preview the motion.',
    art: (
      <>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            {frame(22 + i * 99, 50, 80, 126)}
            {cup(36 + i * 99, 70 - i * 6, 50, (i - 1) * 12)}
          </g>
        ))}
        <path
          d="M 90 203h140m-9-7 9 7-9 7"
          fill="none"
          stroke="#d28a36"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </>
    ),
  },
  spritesheet: {
    description: 'Create a clean grid of consistent sprite frames.',
    art: (
      <>
        {frame(40, 20, 240, 200)}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <rect
              x={51 + (i % 3) * 75}
              y={30 + Math.floor(i / 3) * 92}
              width="68"
              height="84"
              rx="4"
              fill="#e8dfce"
            />
            {cup(60 + (i % 3) * 75, 40 + Math.floor(i / 3) * 92, 40, i % 2 ? 8 : -8)}
          </g>
        ))}
      </>
    ),
  },
  'sprite-atlas': {
    description: 'Organize sprite actions into a structured atlas.',
    art: (
      <>
        {frame(32, 20, 256, 200)}
        {[0, 1, 2].map((row) => (
          <g key={row}>
            <rect
              x="42"
              y={32 + row * 60}
              width="236"
              height="54"
              rx="4"
              fill={['#d7dfcd', '#f0d8b0', '#e7d1c4'][row]}
            />
            {[0, 1, 2, 3].map((col) => (
              <g key={col}>{cup(55 + col * 60, 36 + row * 60, 34, row * 6 - 6)}</g>
            ))}
          </g>
        ))}
      </>
    ),
  },
};

export function WorkflowCardArt({ id }: { id: PreferredWorkflow }) {
  return (
    <svg
      className="create-workflow-card-art"
      viewBox="0 0 320 240"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="320" height="240" fill="#f2ebdf" />
      {WORKFLOW_CARDS[id].art}
    </svg>
  );
}

export function WorkflowCardDescription({ id }: { id: PreferredWorkflow }) {
  return <>{WORKFLOW_CARDS[id].description}</>;
}
