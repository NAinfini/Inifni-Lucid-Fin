// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TodoListCard } from './TodoListCard.js';

const t = (key: string) => ({ 'commander.todo.title': 'Plan' })[key] ?? key;

afterEach(() => cleanup());

describe('TodoListCard', () => {
  it('renders items with progress count in the header', () => {
    render(
      <TodoListCard
        snapshot={{
          todoId: 'todo-1',
          items: [
            { id: 'a', label: 'Plan shots', status: 'done' },
            { id: 'b', label: 'Generate refs', status: 'in_progress' },
            { id: 'c', label: 'Render video', status: 'pending' },
          ],
        }}
        t={t}
      />,
    );
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('1/3')).toBeTruthy();
    expect(screen.getByText(/33%/)).toBeTruthy();
    expect(screen.getByText('Plan shots')).toBeTruthy();
    expect(screen.getByText('Generate refs')).toBeTruthy();
    expect(screen.getByText('Render video')).toBeTruthy();
  });

  it('marks done items with a strike-through style', () => {
    render(
      <TodoListCard
        snapshot={{
          todoId: 'todo-1',
          items: [
            { id: 'a', label: 'Finished step', status: 'done' },
            { id: 'b', label: 'Active step', status: 'in_progress' },
          ],
        }}
        t={t}
      />,
    );
    const finished = screen.getByText('Finished step');
    expect(finished.className).toMatch(/line-through/);
  });

  it('uses the todoId as a data attribute so the card swaps visually on replace', () => {
    const { container } = render(
      <TodoListCard
        snapshot={{
          todoId: 'todo-abc',
          items: [
            { id: 'a', label: 'x', status: 'in_progress' },
            { id: 'b', label: 'y', status: 'pending' },
          ],
        }}
        t={t}
      />,
    );
    const card = container.querySelector('[data-testid="todo-list-card"]');
    expect(card?.getAttribute('data-todo-id')).toBe('todo-abc');
  });
});
