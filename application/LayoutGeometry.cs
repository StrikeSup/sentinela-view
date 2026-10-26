namespace IndependentCenter;

internal static class LayoutGeometry
{
    public static (int Side, Rectangle[] Slots) Create(int count)
    {
        count = Math.Clamp(count, 1, 100);
        int side = (int)Math.Ceiling(Math.Sqrt(count));
        int large = count switch { 6 => 2, 8 => 3, 13 => 2, _ => 1 };
        if (count is 8 or 13) side = 4;
        var slots = new List<Rectangle>();
        if (large > 1) slots.Add(new Rectangle(0, 0, large, large));
        for (int y = 0; y < side; y++)
            for (int x = 0; x < side && slots.Count < count; x++)
                if (large == 1 || x >= large || y >= large) slots.Add(new Rectangle(x, y, 1, 1));
        return (side, slots.ToArray());
    }
}
