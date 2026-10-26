namespace IndependentCenter;

internal static class CenterTheme
{
    public static readonly Color Surface = Color.FromArgb(80, 80, 80);
    public static readonly Color Panel = Color.FromArgb(61, 61, 61);
    public static readonly Color Input = Color.FromArgb(34, 34, 34);
    public static readonly Color Text = Color.FromArgb(210, 210, 210);
    public static void Apply(Control root)
    {
        root.BackColor = root is TextBoxBase or TreeView or ListBox or ComboBox or NumericUpDown ? Input : Panel;
        root.ForeColor = Text;
        if (root is Button button)
        {
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(90, 90, 90);
            button.FlatAppearance.MouseOverBackColor = Surface;
        }
        if (root is TreeView tree) { tree.BorderStyle = BorderStyle.FixedSingle; tree.LineColor = Surface; }
        if (root is TabPage page) page.UseVisualStyleBackColor = false;
        foreach (Control child in root.Controls) Apply(child);
    }
}

internal sealed class LayoutButton : Button
{
    readonly int count;
    public LayoutButton(int count)
    {
        this.count = count;
        AccessibleName = $"Layout de {count} câmeras";
        Width = 57; Height = 34; Margin = new Padding(0, 1, 0, 1);
        FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0;
        BackColor = CenterTheme.Surface; ForeColor = CenterTheme.Text;
    }
    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var area = new Rectangle(14, 6, Width - 28, Height - 12);
        using var pen = new Pen(ForeColor);
        e.Graphics.DrawRectangle(pen, area);
        if (count >= 64) { TextRenderer.DrawText(e.Graphics, count.ToString(), Font, area, ForeColor, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter); return; }
        var geometry = LayoutGeometry.Create(count);
        foreach (var slot in geometry.Slots)
        {
            var cell = new Rectangle(area.Left + area.Width * slot.X / geometry.Side, area.Top + area.Height * slot.Y / geometry.Side, area.Width * slot.Width / geometry.Side, area.Height * slot.Height / geometry.Side);
            e.Graphics.DrawRectangle(pen, cell);
        }
    }
}
