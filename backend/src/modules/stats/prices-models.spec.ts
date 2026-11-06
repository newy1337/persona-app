import { MODEL_OPTIONS } from 'src/brain/config/models';
import { DEFAULT_PRICES, resolvePrice } from './prices';

describe('цены моделей по умолчанию', () => {
  it.each(MODEL_OPTIONS.map(([id]) => id))(
    'у модели %s из выбора есть цена — вызовы не считаются по нулю',
    (id) => {
      const price = resolvePrice(DEFAULT_PRICES, id);
      expect(price).not.toBeNull();
      expect(price!.input).toBeGreaterThan(0);
      expect(price!.output).toBeGreaterThan(0);
    },
  );
});
