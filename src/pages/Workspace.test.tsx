import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Workspace from './Workspace';

// Mock dependencies
vi.mock('../components/ChatPane', () => ({
    __esModule: true,
    ChatPane: ({ errorState }: any) => (
        <div data-testid="chat-pane">
            Chat Pane
            {errorState && <span data-testid="chat-error">{errorState.message}</span>}
        </div>
    ),
    default: ({ errorState }: any) => (
        <div data-testid="chat-pane">
            Chat Pane
            {errorState && <span data-testid="chat-error">{errorState.message}</span>}
        </div>
    )
}));

vi.mock('../components/BoardPane', () => ({
    __esModule: true,
    BoardPane: ({ sections }: any) => (
        <div data-testid="board-pane">
            Board Pane
            <span data-testid="section-count">{sections.length}</span>
        </div>
    ),
    default: ({ sections }: any) => (
        <div data-testid="board-pane">
            Board Pane
            <span data-testid="section-count">{sections.length}</span>
        </div>
    )
}));

vi.mock('../components/boardPaneLoader', () => {
    const FakeBoardPane = ({ sections }: any) => (
        <div data-testid="board-pane">
            Board Pane
            <span data-testid="section-count">{sections?.length || 0}</span>
        </div>
    );
    return {
        loadBoardPane: () => Promise.resolve({ default: FakeBoardPane, BoardPane: FakeBoardPane })
    };
});

vi.mock('../state/workspacePersistence', () => ({
    createPersistedSnapshot: vi.fn(),
    restorePersistedSnapshot: vi.fn(),
    persistWorkspaceSnapshot: vi.fn(),
    STORAGE_KEY: 'test-key',
    STORAGE_PROFILES: { normal: { compress: false } }
}));

describe('Workspace', () => {
    it('renders the initial layout with Chat and Board panes', async () => {
        const { findByTestId, findByText } = render(
            <MemoryRouter>
                <Workspace />
            </MemoryRouter>
        );

        await findByTestId('chat-pane');
        await findByTestId('board-pane');
        await findByText('AI 工作台');
    });
});

