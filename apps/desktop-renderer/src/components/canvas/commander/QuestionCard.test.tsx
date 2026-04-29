// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionCard } from './QuestionCard.js';

const t = (key: string): string =>
  (
    ({
      'commander.question.title': 'Question Tool:',
      'commander.question.otherAnswer': 'Other answer...',
      'commander.question.submit': 'Submit',
    }) as Record<string, string>
  )[key] ?? key;

afterEach(() => {
  cleanup();
});

describe('QuestionCard', () => {
  it('shows toggle link for custom input initially', () => {
    render(<QuestionCard question="Pick one" options={[]} onAnswer={() => {}} t={t} />);

    expect(screen.getByText('Other answer...')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Other answer...')).toBeNull();
  });

  it('reveals custom input after clicking toggle', () => {
    render(<QuestionCard question="Pick one" options={[]} onAnswer={() => {}} t={t} />);

    fireEvent.click(screen.getByText('Other answer...'));
    expect(screen.getByPlaceholderText('Other answer...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
  });

  it('renders option buttons and filters blank labels', () => {
    render(
      <QuestionCard
        question="Long question"
        options={[{ label: '   ' }, { label: 'Yes' }, { label: '' }]}
        onAnswer={() => {}}
        t={t}
      />,
    );

    expect(screen.getByText('Long question')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeTruthy();
  });

  it('uses stable list keys so duplicate labels do not trigger React key warnings', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <QuestionCard
        question="Choose"
        options={[{ label: 'Yes' }, { label: 'Yes' }]}
        onAnswer={() => {}}
        t={t}
      />,
    );

    const duplicateKeyWarning = consoleError.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === 'string' && arg.includes('Encountered two children with the same key'),
      ),
    );
    expect(duplicateKeyWarning).toBe(false);

    consoleError.mockRestore();
  });

  it('submits trimmed custom answer on Enter and click', () => {
    const onAnswer = vi.fn();

    render(<QuestionCard question="Q" options={[]} onAnswer={onAnswer} t={t} />);

    fireEvent.click(screen.getByText('Other answer...'));

    const input = screen.getByPlaceholderText('Other answer...');
    fireEvent.change(input, { target: { value: '  hello  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAnswer).toHaveBeenCalledWith('hello');

    fireEvent.change(input, { target: { value: '  world  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAnswer).toHaveBeenCalledWith('world');
  });
});
