import React from 'react';
import Tooltip from '../Tooltip';

export function FloatingTooltip({
  content,
  children,
  delay,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <Tooltip content={content} delay={delay} className="h-full w-full">
      {children}
    </Tooltip>
  );
}
