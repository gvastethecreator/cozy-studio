/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DropZoneOverlay from '../components/DropZoneOverlay';
import { useImageInputSurface } from './useImageInputSurface';

afterEach(cleanup);

it('clears the drop hint when a nested reference tray consumes the drop or the drag ends', () => {
  const onFiles = vi.fn();
  const onTrayDrop = vi.fn();
  function InputSurface() {
    const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useImageInputSurface({
      onFiles,
    });
    return (
      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <DropZoneOverlay isVisible={isDragging} />
        <div
          data-testid="reference-tray"
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onTrayDrop();
          }}
        />
      </div>
    );
  }
  render(<InputSurface />);
  const tray = screen.getByTestId('reference-tray');
  fireEvent.dragOver(tray);
  expect(screen.getByText('Drop images to synthesize')).toBeTruthy();
  fireEvent.drop(tray);
  expect(screen.queryByText('Drop images to synthesize')).toBeNull();
  expect(onTrayDrop).toHaveBeenCalledOnce();
  expect(onFiles).not.toHaveBeenCalled();

  fireEvent.dragOver(tray);
  expect(screen.getByText('Drop images to synthesize')).toBeTruthy();
  fireEvent.dragEnd(tray);
  expect(screen.queryByText('Drop images to synthesize')).toBeNull();
});
