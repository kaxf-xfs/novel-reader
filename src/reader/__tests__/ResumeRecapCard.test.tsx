import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithSettings } from '../../test-utils/render';
import { SettingsProvider } from '../../settings/SettingsContext';
import { ResumeRecapCard } from '../ResumeRecapCard';

const baseProps = {
  visible: true,
  chapterLabel: '第 12 章',
  daysSinceRead: 12,
  loadCachedRecap: async () => ({ kind: 'text' as const, text: '前情回顾内容' }),
  generateRecap: async () => '生成结果',
  onDismiss: jest.fn(),
};

describe('ResumeRecapCard', () => {
  it('缓存命中 → 展示回顾文字', async () => {
    renderWithSettings(<ResumeRecapCard {...baseProps} />);
    expect(await screen.findByTestId('recap-text')).toHaveTextContent('前情回顾内容', { exact: false });
  });

  it('needs-generation → 显按钮，点击后回填并展示结果', async () => {
    const generateRecap = jest.fn(async (onP: (d: number, t: number) => void) => {
      onP(1, 2);
      return '生成结果';
    });
    renderWithSettings(
      <ResumeRecapCard
        {...baseProps}
        loadCachedRecap={async () => ({ kind: 'needs-generation' as const })}
        generateRecap={generateRecap}
      />,
    );
    const btn = await screen.findByTestId('recap-generate');
    await act(async () => {
      fireEvent.press(btn);
    });
    expect(generateRecap).toHaveBeenCalled();
    expect(await screen.findByTestId('recap-text')).toHaveTextContent('生成结果', { exact: false });
  });

  it('× 关闭 → onDismiss', async () => {
    const onDismiss = jest.fn();
    renderWithSettings(<ResumeRecapCard {...baseProps} onDismiss={onDismiss} />);
    await screen.findByTestId('recap-text');
    fireEvent.press(screen.getByTestId('recap-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('visible=false 不加载，卸载/隐藏时取消在途请求（无 act 警告）', async () => {
    let capturedSignal: AbortSignal | undefined;
    const loadCachedRecap = jest.fn((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<{ kind: 'text'; text: string }>(() => {
        // never resolves — simulate an in-flight request
      });
    });
    const { gateway, rerender, unmount } = renderWithSettings(
      <ResumeRecapCard {...baseProps} loadCachedRecap={loadCachedRecap} />,
    );
    await act(async () => {});
    expect(loadCachedRecap).toHaveBeenCalled();
    expect(capturedSignal?.aborted).toBe(false);

    rerender(
      <SettingsProvider gateway={gateway}>
        <ResumeRecapCard {...baseProps} loadCachedRecap={loadCachedRecap} visible={false} />
      </SettingsProvider>,
    );
    expect(capturedSignal?.aborted).toBe(true);

    unmount();
  });

  it('生成中显示进度文案', async () => {
    let onProgressCb!: (d: number, t: number) => void;
    let resolveFinal!: (v: string) => void;
    const generateRecap = jest.fn((onP: (d: number, t: number) => void) => {
      onProgressCb = onP;
      return new Promise<string>((resolve) => {
        resolveFinal = resolve;
      });
    });
    renderWithSettings(
      <ResumeRecapCard
        {...baseProps}
        loadCachedRecap={async () => ({ kind: 'needs-generation' as const })}
        generateRecap={generateRecap}
      />,
    );
    const btn = await screen.findByTestId('recap-generate');
    await act(async () => {
      fireEvent.press(btn);
    });
    await act(async () => {
      onProgressCb(1, 3);
    });
    expect(await screen.findByTestId('recap-progress')).toHaveTextContent('1/3', { exact: false });
    await act(async () => {
      resolveFinal('完成');
    });
    await screen.findByTestId('recap-text');
  });

  it('loadCachedRecap 失败 → 展示 recap-error', async () => {
    renderWithSettings(
      <ResumeRecapCard
        {...baseProps}
        loadCachedRecap={async () => {
          throw new Error('load failed');
        }}
      />,
    );
    expect(await screen.findByTestId('recap-error')).toHaveTextContent('加载回顾失败，请重试。', { exact: false });
  });

  it('needs-generation → 点击生成后 generateRecap 失败 → 展示 recap-error', async () => {
    renderWithSettings(
      <ResumeRecapCard
        {...baseProps}
        loadCachedRecap={async () => ({ kind: 'needs-generation' as const })}
        generateRecap={async () => {
          throw new Error('generate failed');
        }}
      />,
    );
    const btn = await screen.findByTestId('recap-generate');
    await act(async () => {
      fireEvent.press(btn);
    });
    expect(await screen.findByTestId('recap-error')).toHaveTextContent('生成回顾失败，请重试。', { exact: false });
  });

  it('daysSinceRead=0 → 文案显示「就在今天」而非「0 天前」', async () => {
    renderWithSettings(<ResumeRecapCard {...baseProps} daysSinceRead={0} />);
    const card = await screen.findByTestId('resume-recap-card');
    expect(card).toHaveTextContent('就在今天', { exact: false });
    expect(card).not.toHaveTextContent('0 天前', { exact: false });
  });

  it('生成中点「取消」→ abort 在途请求并退回 needs-generation（不关整张卡）', async () => {
    let capturedSignal: AbortSignal | undefined;
    const generateRecap = jest.fn((_onP: (d: number, t: number) => void, signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<string>(() => {
        // never resolves — simulate an in-flight backfill
      });
    });
    const onDismiss = jest.fn();
    renderWithSettings(
      <ResumeRecapCard
        {...baseProps}
        loadCachedRecap={async () => ({ kind: 'needs-generation' as const })}
        generateRecap={generateRecap}
        onDismiss={onDismiss}
      />,
    );
    const btn = await screen.findByTestId('recap-generate');
    await act(async () => {
      fireEvent.press(btn);
    });
    fireEvent.press(await screen.findByTestId('recap-cancel'));
    expect(capturedSignal?.aborted).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled(); // 取消 ≠ 关卡
    // 退回 needs-generation：生成按钮重新出现、可重试
    expect(await screen.findByTestId('recap-generate')).toBeTruthy();
  });
});
