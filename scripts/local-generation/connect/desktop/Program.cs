using System;
using System.Drawing;
using System.Windows.Forms;
using System.Threading.Tasks;

namespace Kavero.Connect {
  internal static class Program {
    [STAThread] static int Main(string[] args) {
      AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
      try {
        Format.Require(args.Length<=1,"unsupported-command");string command=args.Length==0?"":args[0];
        Format.Require(command==""||command=="--install"||command=="--diagnose"||command=="--check-bundle"||command=="--remove-code","unsupported-command");
        using(var installation=new Installation()){
          if(command=="--check-bundle"){installation.Inspect();return 0;}
          if(command=="--install"){installation.Install();return 0;}
          if(command=="--diagnose"){installation.Diagnostic();return 0;}
          if(command=="--remove-code"){installation.RemoveCode();return 0;}
          Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);installation.Inspect();Application.Run(installation.Present&&installation.RunningInstalled?(Form)new CompanionForm(installation):new Welcome(installation));return 0;
        }
      }catch(Exception error){if(args.Length==0)MessageBox.Show(Friendly(error),"Kavero Connect",MessageBoxButtons.OK,MessageBoxIcon.Information);else Console.Error.WriteLine(error is System.IO.InvalidDataException?error.Message:"companion-operation-failed:"+error.GetType().Name);return 2;}
    }
    internal static string Friendly(Exception error){
      if(error.Message=="companion-already-open")return "Kavero Connect is already open. Close its other window before installing or removing this preview.";
      if(error.Message=="different-version-installed"||error.Message=="different-launcher-installed")return "Another version is installed. This preview cannot update it yet. Your models and data have been kept.";
      if(error.Message=="installation-not-owned"||error.Message=="installation-config-missing"||error.Message=="interrupted-installation")return "The installation needs recovery. Existing files have been kept. Close Kavero Connect and review the installation before retrying.";
      return "Kavero Connect could not verify or open this installation. Existing data has been kept. Use a trusted installer and try again.";
    }
  }
  internal sealed class Welcome:Form {
    readonly Installation installation;readonly Label status;readonly Button primary;readonly Button remove;bool busy;
    internal Welcome(Installation value){
      installation=value;Text=Publisher.Channel=="developer"?"Kavero Connect — Developer Preview":"Kavero Connect";ClientSize=new Size(600,410);MinimumSize=new Size(616,449);MaximumSize=MinimumSize;StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(14,16,21);ForeColor=Color.FromArgb(236,239,246);Font=new Font("Segoe UI",10);MaximizeBox=false;FormClosing+=(sender,args)=>{if(busy)args.Cancel=true;};
      Controls.Add(Label("KAVERO  /  CONNECT",28,28,500,28,10,Color.FromArgb(151,164,187)));
      Controls.Add(Label(installation.Present?"Ready on this computer.":"Your PC. Your models.",26,83,550,52,26,ForeColor));
      Controls.Add(Label(installation.Present?"Open the companion to connect your Kavero account\nand set up an image model on this computer.":"Install the companion for Kavero on this computer.\nNo extra runtime or developer tools to install.",28,150,544,56,11,Color.FromArgb(173,182,200)));
      status=Label(Publisher.Channel=="developer"?"DEVELOPER PREVIEW  ·  Unsigned Windows build":"PREVIEW  ·  Verify the installer’s publisher before use",28,222,544,30,9,Color.FromArgb(188,194,208));Controls.Add(status);
      Controls.Add(Label("Installation does not accept model terms.\nAccount and model setup happen in the companion.",28,262,544,48,9,Color.FromArgb(143,154,176)));
      primary=Button(installation.Present?(installation.RunningInstalled?"Verify installation":"Open companion"):"Install on this PC",28,337,176,true);primary.Click+=async(sender,args)=>await Run(async()=>{if(installation.Present&&!installation.RunningInstalled){installation.Open();BeginInvoke(new Action(Close));return;}await Task.Run(()=>{installation.Install();installation.Diagnostic();});status.Text="Installed and verified  ·  Not connected";primary.Text=installation.RunningInstalled?"Verify installation":"Open companion";remove.Visible=!installation.RunningInstalled;});Controls.Add(primary);
      var notices=Button("Notices",216,337,102,false);notices.Click+=(sender,args)=>{using(var dialog=new Form {Text="Shipped component notices",Size=new Size(760,620),StartPosition=FormStartPosition.CenterParent,BackColor=BackColor,ForeColor=ForeColor}){dialog.Controls.Add(new TextBox {Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Both,Dock=DockStyle.Fill,Text=installation.Notices(),BackColor=BackColor,ForeColor=ForeColor,Font=new Font("Consolas",9)});dialog.ShowDialog(this);}};Controls.Add(notices);
      remove=Button("Remove app",330,337,112,false);remove.Visible=installation.Present&&!installation.RunningInstalled;remove.Click+=async(sender,args)=>{if(MessageBox.Show(this,"Remove companion code only? Models, results and connection identity are kept.","Remove app",MessageBoxButtons.OKCancel)!=DialogResult.OK)return;if(!await Run(()=>Task.Run(()=>{installation.RemoveCode();})))return;primary.Text="Install on this PC";status.Text="App removed  ·  Data kept";remove.Visible=false;};Controls.Add(remove);
      var close=Button("Close",454,337,116,false);close.Click+=(sender,args)=>Close();Controls.Add(close);
      if(installation.Present&&installation.RunningInstalled)Shown+=async(sender,args)=>await Run(async()=>{await Task.Run(()=>installation.Diagnostic());status.Text="Installed and verified  ·  Not connected";});
    }
    Label Label(string text,int x,int y,int width,int height,int size,Color color){return new Label {Text=text,Location=new Point(x,y),Size=new Size(width,height),Font=new Font("Segoe UI",size),ForeColor=color};}
    Button Button(string text,int x,int y,int width,bool filled){var b=new Button {Text=text,Location=new Point(x,y),Size=new Size(width,40),FlatStyle=FlatStyle.Flat,BackColor=filled?Color.FromArgb(230,235,247):Color.FromArgb(29,33,43),ForeColor=filled?Color.FromArgb(15,18,25):ForeColor,Cursor=Cursors.Hand};b.FlatAppearance.BorderSize=0;return b;}
    async Task<bool> Run(Func<Task> action){if(busy)return false;busy=true;primary.Enabled=false;remove.Enabled=false;try{await action();return true;}catch(Exception error){MessageBox.Show(this,Program.Friendly(error),"Kavero Connect",MessageBoxButtons.OK,MessageBoxIcon.Information);return false;}finally{busy=false;primary.Enabled=true;remove.Enabled=true;}}
  }
}
