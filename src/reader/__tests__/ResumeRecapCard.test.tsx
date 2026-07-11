import { act, fireEvent, screen } from '@testing-library/react-native';

import { renderWithSettings } from '../../test-utils/render';
import { SettingsProvider } from '../../settings/SettingsContext';
import { ResumeRecapCard } from '../ResumeRecapCard';

const baseProps = {
  visible: true,
  chapterLabel: '第 12 章',
  gapDays: 7,
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
});
