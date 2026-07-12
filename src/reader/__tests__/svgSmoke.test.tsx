import { render } from '@testing-library/react-native';
import Svg, { Circle, Line, Text as SvgText, G } from 'react-native-svg';

describe('react-native-svg jest transform', () => {
  it('renders Svg primitives without throwing', () => {
    const { getByTestId } = render(
      <Svg testID="svg-root" width={100} height={100}>
        <G>
          <Circle cx={50} cy={50} r={10} fill="#000" />
          <Line x1={0} y1={0} x2={100} y2={100} stroke="#000" />
          <SvgText x={10} y={10}>标签</SvgText>
        </G>
      </Svg>,
    );
    expect(getByTestId('svg-root')).toBeTruthy();
  });
});
