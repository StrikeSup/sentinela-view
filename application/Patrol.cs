namespace IndependentCenter;
public sealed class PatrolStep
{
    public Guid LayoutId {get;set;}
    public int Seconds {get;set;}=10;
}
public sealed class PatrolPlan
{
    public Guid Id {get;set;}=Guid.NewGuid();
    public string Name {get;set;}="";
    public List<PatrolStep> Steps {get;set;}=[];
    public override string ToString()=>Name;
}
public sealed class PatrolRunner
{
    readonly List<PatrolStep> steps;int index;DateTimeOffset next;
    public Guid Current=>steps[index].LayoutId;
    public PatrolRunner(PatrolPlan plan,DateTimeOffset now)
    {
        if(plan.Steps.Count==0)throw new ArgumentException("A ronda precisa de pelo menos um layout.");
        steps=plan.Steps.Select(s=>new PatrolStep{LayoutId=s.LayoutId,Seconds=Math.Clamp(s.Seconds,5,1200)}).ToList();next=now.AddSeconds(steps[0].Seconds);
    }
    public Guid? Advance(DateTimeOffset now){if(now<next)return null;index=(index+1)%steps.Count;next=now.AddSeconds(steps[index].Seconds);return Current;}
}
public sealed class PatrolDialog : Form
{
    sealed class Row
    {
        public required SavedLayout Layout;public int Seconds=10;
        public override string ToString()=>Layout.Name+" — "+Seconds+" s";
    }
    public PatrolPlan Result {get;private set;}=new();
    public PatrolDialog(Store store,PatrolPlan? original=null)
    {
        Text="Ronda virtual";ClientSize=new Size(620,430);StartPosition=FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        var name=new TextBox{Left=130,Top=20,Width=460,MaxLength=35,Text=original?.Name??""};
        var available=new ListBox{Left=20,Top=85,Width=230,Height=245,DataSource=store.Data.Layouts.ToList()};var selected=new ListBox{Left=345,Top=85,Width=245,Height=245};var seconds=new NumericUpDown{Left=465,Top=345,Width=125,Minimum=5,Maximum=1200,Value=10};
        Controls.AddRange([new Label{Text="Nome da ronda",Left=20,Top=23},name,new Label{Text="Layouts disponíveis",Left=20,Top=60,Width=230},available,new Label{Text="Sequência",Left=345,Top=60},selected,new Label{Text="Permanência (s)",Left=345,Top=348,Width=115},seconds]);
        void Button(string text,int top,Action action){var b=new Button{Text=text,Left=265,Top=top,Width=65};b.Click+=(_,_)=>action();Controls.Add(b);}
        Button("Adicionar",100,()=>{if(available.SelectedItem is SavedLayout l&&!selected.Items.Cast<Row>().Any(r=>r.Layout.Id==l.Id)){selected.Items.Add(new Row{Layout=l,Seconds=(int)seconds.Value});selected.SelectedIndex=selected.Items.Count-1;}});
        Button("Remover",140,()=>{if(selected.SelectedIndex>=0)selected.Items.RemoveAt(selected.SelectedIndex);});
        void Move(int delta){var i=selected.SelectedIndex;var to=i+delta;if(i<0||to<0||to>=selected.Items.Count)return;var row=selected.Items[i];selected.Items.RemoveAt(i);selected.Items.Insert(to,row);selected.SelectedIndex=to;}
        Button("Subir",200,()=>Move(-1));Button("Descer",240,()=>Move(1));
        Shown += (_, _) => CenterTheme.Apply(this);
        bool loading=false;selected.SelectedIndexChanged+=(_,_)=>{if(selected.SelectedItem is Row r){loading=true;seconds.Value=Math.Clamp(r.Seconds,5,1200);loading=false;}};
        seconds.ValueChanged+=(_,_)=>{if(!loading&&selected.SelectedItem is Row r){r.Seconds=(int)seconds.Value;var i=selected.SelectedIndex;selected.Items[i]=r;}};
        if(original is not null)foreach(var s in original.Steps){var l=store.Data.Layouts.FirstOrDefault(l=>l.Id==s.LayoutId);if(l is not null)selected.Items.Add(new Row{Layout=l,Seconds=s.Seconds});}
        var save=new Button{Text="Salvar",Left=490,Top=390,Width=100};Controls.Add(save);save.Click+=(_,_)=>{if(name.Text.Trim().Length<1||selected.Items.Count==0){MessageBox.Show(this,"Informe o nome e adicione pelo menos um layout.");return;}if(store.Data.Patrols.Any(p=>p.Id!=original?.Id&&p.Name.Equals(name.Text.Trim(),StringComparison.OrdinalIgnoreCase))){MessageBox.Show(this,"Já existe uma ronda com esse nome.");return;}Result=new(){Id=original?.Id??Guid.NewGuid(),Name=name.Text.Trim(),Steps=selected.Items.Cast<Row>().Select(r=>new PatrolStep{LayoutId=r.Layout.Id,Seconds=r.Seconds}).ToList()};DialogResult=DialogResult.OK;};
    }
}
