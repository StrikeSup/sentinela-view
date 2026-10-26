using System.Security.Cryptography;
namespace IndependentCenter;
public sealed class Account
{
    public string Name { get; set; } = "";
    public string Role { get; set; } = "Visualizador";
    public string Salt { get; set; } = "";
    public string Hash { get; set; } = "";
    public void SetPassword(string password)
    {
        if (password.Length < 8) throw new ArgumentException("A senha deve ter pelo menos oito caracteres.");
        var salt = RandomNumberGenerator.GetBytes(16); Salt = Convert.ToBase64String(salt); Hash = Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(password, salt, 210000, HashAlgorithmName.SHA256, 32));
    }
    public bool Verify(string password) => CryptographicOperations.FixedTimeEquals(Convert.FromBase64String(Hash), Rfc2898DeriveBytes.Pbkdf2(password, Convert.FromBase64String(Salt), 210000, HashAlgorithmName.SHA256, 32));
    public bool CanConfigure => Role == "Administrador";
    public bool CanOperate => Role is "Administrador" or "Operador";
}
public sealed class LoginDialog : Form
{
    public Account? Account { get; private set; }
    public LoginDialog(Store store)
    {
        bool setup = store.Data.Accounts.Count == 0; Text = setup ? "Primeiro acesso — criar administrador" : "Entrar — Center"; ClientSize = new Size(390, 230); StartPosition = FormStartPosition.CenterScreen; FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
        var user = new TextBox { Left = 130, Top = 35, Width = 230, Text = setup ? "admin" : "" }; var password = new TextBox { Left = 130, Top = 80, Width = 230, UseSystemPasswordChar = true }; var confirm = new TextBox { Left = 130, Top = 120, Width = 230, UseSystemPasswordChar = true }; var login = new Button { Left = 245, Top = 175, Width = 115, Text = setup ? "Criar e entrar" : "Entrar" }; var error = new Label { Left = 20, Top = 150, Width = 350, ForeColor = Color.Firebrick };
        Controls.AddRange([new Label { Text = "Usuário", Left = 20, Top = 38 }, user, new Label { Text = "Senha", Left = 20, Top = 83 }, password, login, error]); if (setup) Controls.AddRange([new Label { Text = "Confirmar", Left = 20, Top = 123 }, confirm]); AcceptButton = login;
        CenterTheme.Apply(this); error.ForeColor = Color.Salmon;
        int failures = 0; DateTime blocked = DateTime.MinValue;
        login.Click += (_, _) => { if (DateTime.UtcNow < blocked) { error.Text = "Aguarde alguns segundos para tentar novamente."; return; } try { if (setup) { if (user.Text.Trim().Length < 3) throw new ArgumentException("Usuário deve ter três ou mais caracteres."); if (password.Text != confirm.Text) throw new ArgumentException("As senhas não coincidem."); var a = new Account { Name = user.Text.Trim(), Role = "Administrador" }; a.SetPassword(password.Text); store.Data.Accounts.Add(a); store.Save(); Account = a; } else { Account = store.Data.Accounts.FirstOrDefault(a => string.Equals(a.Name, user.Text.Trim(), StringComparison.OrdinalIgnoreCase) && a.Verify(password.Text)); if (Account is null) { failures++; blocked = DateTime.UtcNow.AddSeconds(Math.Min(30, failures * 2)); throw new ArgumentException("Usuário ou senha inválidos."); } } store.Log("Login: " + Account.Name); DialogResult = DialogResult.OK; } catch (Exception e) { error.Text = e.Message; } };
    }
}
public sealed class AccountsWindow : Form
{
    public AccountsWindow(Store store, Account current)
    {
        Text = "Usuários"; ClientSize = new Size(510, 310); StartPosition = FormStartPosition.CenterParent;
        var list = new ListBox { Left = 15, Top = 15, Width = 180, Height = 235, DisplayMember = "Name" }; var name = new TextBox { Left = 220, Top = 35, Width = 260 }; var pass = new TextBox { Left = 220, Top = 95, Width = 260, UseSystemPasswordChar = true }; var role = new ComboBox { Left = 220, Top = 155, Width = 260, DropDownStyle = ComboBoxStyle.DropDownList }; role.Items.AddRange(["Administrador", "Operador", "Visualizador"]); role.SelectedIndex = 2;
        Controls.AddRange([list, name, pass, role, new Label { Left = 220, Top = 15, Text = "Nome" }, new Label { Left = 220, Top = 75, Text = "Nova senha" }, new Label { Left = 220, Top = 135, Text = "Permissão" }]);
        void RefreshUsers() { list.DataSource = null; list.DataSource = store.Data.Accounts.ToList(); }
        var save = new Button { Text = "Salvar", Left = 220, Top = 210 }; var add = new Button { Text = "Novo", Left = 305, Top = 210 }; var delete = new Button { Text = "Excluir", Left = 390, Top = 210 }; Controls.AddRange([save, add, delete]);
        list.SelectedIndexChanged += (_, _) => { if (list.SelectedItem is Account a) { name.Text = a.Name; role.SelectedItem = a.Role; pass.Clear(); } };
        add.Click += (_, _) => { list.ClearSelected(); name.Clear(); pass.Clear(); role.SelectedIndex = 2; };
        save.Click += (_, _) => { try { var existing = list.SelectedItem as Account; if (name.Text.Trim().Length < 3) throw new Exception("Nome deve ter três ou mais caracteres."); if (store.Data.Accounts.Any(a => a != existing && a.Name.Equals(name.Text.Trim(), StringComparison.OrdinalIgnoreCase))) throw new Exception("Usuário já cadastrado."); if (existing == current && role.Text != "Administrador") throw new Exception("Não altere a permissão do administrador conectado."); var candidate = new Account { Name = name.Text.Trim(), Role = role.Text, Salt = existing?.Salt ?? "", Hash = existing?.Hash ?? "" }; if (pass.Text.Length > 0 || existing is null) candidate.SetPassword(pass.Text); if (existing is null) store.Data.Accounts.Add(candidate); else { existing.Name = candidate.Name; existing.Role = candidate.Role; existing.Salt = candidate.Salt; existing.Hash = candidate.Hash; } store.Save(); RefreshUsers(); } catch (Exception e) { MessageBox.Show(this, e.Message); } };
        delete.Click += (_, _) => { if (list.SelectedItem is not Account a || a == current) return; if (MessageBox.Show(this, "Excluir o usuário " + a.Name + "?", "Usuários", MessageBoxButtons.YesNo) == DialogResult.Yes) { store.Data.Accounts.Remove(a); store.Save(); RefreshUsers(); } };
        RefreshUsers();
        FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
        CenterTheme.Apply(this);
    }
}
