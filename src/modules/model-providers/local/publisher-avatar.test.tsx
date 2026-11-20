import { afterEach, it, expect } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PublisherAvatar } from './publisher-avatar';

afterEach(cleanup);
it('uses a bundled verified logo for known publishers without a remote image request', () => {
  render(<PublisherAvatar publisher="Qwen"/>);
  const image = screen.getByRole('img', { name: 'Qwen publisher avatar' });
  expect(new URL(image.getAttribute('src')!, window.location.href).pathname).toBe('/models/catalog/qwen.webp');
  expect(new URL(image.getAttribute('src')!, window.location.href).origin).toBe(window.location.origin);
  expect(image).toHaveAttribute('loading', 'lazy');
  expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
});
it('falls back on failure and retries when the publisher changes', () => {
  const view = render(<PublisherAvatar publisher="Qwen"/>);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.getByText('QW')).toBeVisible();
  view.rerender(<PublisherAvatar publisher="unsloth"/>);
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://huggingface.co/api/avatars/unsloth');
});
it('encodes namespace input as one path segment, never a supplied URL', () => {
  render(<PublisherAvatar publisher="other/name?query=1"/>);
  expect(screen.getByRole('img')).toHaveAttribute('src', 'https://huggingface.co/api/avatars/other%2Fname%3Fquery%3D1');
});
