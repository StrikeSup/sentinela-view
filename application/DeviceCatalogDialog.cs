namespace IndependentCenter;

public sealed class DeviceCatalogDialog : Form
{
    public List<Camera> Cameras { get; } = [];
    public DeviceCatalogDialog()
    {
        Text = "Adicionar equipamento — fabricante e modelo"; ClientSize = new Size(740, 520); StartPosition = FormStartPosition.CenterParent;
        var vendor = new ComboBox { Left=20, Top=45, Width=700, DropDownStyle=ComboBoxStyle.DropDownList };
        vendor.Items.AddRange(DeviceCatalog.Vendors.ToArray()); vendor.SelectedIndex=0;
        var search = new TextBox { Left=20, Top=105, Width=700, PlaceholderText="Filtrar modelos deste fabricante" };
        var models = new ListBox { Left=20, Top=145, Width=700, Height=190 };
        var details = new TextBox { Left=20, Top=345, Width=700, Height=100, Multiline=true, ReadOnly=true, ScrollBars=ScrollBars.Vertical };
        var add = new Button { Left=420, Top=465, Width=180, Text="Consultar via ONVIF" };
        var close = new Button { Left=610, Top=465, Width=110, Text="Cancelar", DialogResult=DialogResult.Cancel };
        Controls.AddRange([new Label { Left=20, Top=20, Width=400, Text="Fabricante — catálogo recuperado da versão 7.5.0.4" }, vendor, new Label { Left=20, Top=82, Text="Modelo" },search,models,details,add,close]);
        void RefreshModels() { models.BeginUpdate(); models.Items.Clear(); if(vendor.SelectedItem is DeviceVendor v) models.Items.AddRange(v.Models.Where(m=>m.Name.Contains(search.Text.Trim(),StringComparison.CurrentCultureIgnoreCase)).ToArray()); if(models.Items.Count>0) models.SelectedIndex=0; models.EndUpdate(); SelectModel(); }
        void SelectModel()
        {
            var m=models.SelectedItem as DeviceModel; add.Enabled=m?.OnvifDiscovery == true || m?.DahuaDiscovery == true;
            add.Text=m?.DahuaDiscovery == true ? "Consultar via CGI Dahua" : "Consultar via ONVIF";
            details.Text=m is null ? "Nenhum modelo encontrado." : m.Name+Environment.NewLine+m.Status+Environment.NewLine+"Conector original: "+m.Connector+Environment.NewLine+
                string.Join(" · ",new[]{"firmware","camerasCount","streamsCount","codecs","defaultPort"}.Where(k=>m.Original.TryGetProperty(k,out _)).Select(k=>k+": "+m.Original.GetProperty(k).ToString()));
        }
        vendor.SelectedIndexChanged+=(_,_)=>RefreshModels(); search.TextChanged+=(_,_)=>RefreshModels(); models.SelectedIndexChanged+=(_,_)=>SelectModel();
        add.Click+=(_,_)=>
        {
            if(models.SelectedItem is not DeviceModel m || !(m.OnvifDiscovery || m.DahuaDiscovery)) return;
            using var discovery=new OnvifDialog(model:m);
            if(discovery.ShowDialog(this)!=DialogResult.OK) return;
            foreach(var camera in discovery.Cameras) { camera.VendorId=m.VendorId; camera.ModelId=m.Id; Cameras.Add(camera); }
            DialogResult=DialogResult.OK;
        };
        CancelButton=close; RefreshModels(); SelectModel(); CenterTheme.Apply(this);
    }
}
