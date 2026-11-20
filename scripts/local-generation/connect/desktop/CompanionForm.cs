using System;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Kavero.Connect {
  internal sealed class CompanionForm:Form {
    readonly Installation installation;ControllerSession session;readonly Label state,detail,fingerprint,modelState,connectionTitle,connectedLabel;readonly TextBox code;readonly ComboBox profiles;readonly Timer refresh;Button quitButton,pairButton,approveButton,setupButton,cancelSetupButton,pauseResumeButton,disconnectButton;LinkLabel resetLink;CheckBox settingsToggle;Dictionary<string,object> snapshot;bool busy,closing,pausedNow=true;
    internal CompanionForm(Installation value){
      installation=value;Text=Publisher.Channel=="developer"?"Kavero Connect — Developer Preview":"Kavero Connect";ClientSize=new Size(660,590);MinimumSize=new Size(676,629);MaximumSize=MinimumSize;StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(14,16,21);ForeColor=Color.FromArgb(236,239,246);Font=new Font("Segoe UI",10);MaximizeBox=false;
      AddLabel("KAVERO  /  CONNECT",28,24,604,24,10,Color.FromArgb(151,164,187));
      state=AddLabel("Opening your companion…",26,65,610,44,24,ForeColor);
      detail=AddLabel(Publisher.Origin,28,119,604,44,10,Color.FromArgb(173,182,200));
      connectionTitle=AddLabel("Connect this computer",28,176,604,24,13,ForeColor);
      connectedLabel=AddLabel("Your account is connected. Model permission is checked separately.",28,211,604,30,10,Color.FromArgb(173,182,200));
      code=new TextBox {Location=new Point(28,211),Size=new Size(294,30),MaxLength=29,BackColor=Color.FromArgb(29,33,43),ForeColor=ForeColor,BorderStyle=BorderStyle.FixedSingle,AccessibleName="Pairing code from Kavero"};Controls.Add(code);
      pairButton=ActionButton("Connect",334,207,128,()=>Run(async()=>ShowState(await Send("pair","code",code.Text.Trim().Replace("-","").ToLowerInvariant()))));
      approveButton=ActionButton("Confirm account",334,207,220,()=>Run(async()=>{
        var result=await Send("inspect-account");if(closing)return;ShowState(result);var account=Format.Object(result["account"]);
        var prompt="Allow this account to use this computer?\n\n"+Publisher.Origin+"\nAccount: "+Format.Text(account["owner"])+"\nFingerprint: "+Format.Text(result["fingerprint"])+"\n\nCheck that these match your signed-in Kavero page. Model permission is separate.";
        if(MessageBox.Show(this,prompt,"Confirm paired account",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes)ShowState(await Send("approve-owner","token",Format.Text(account["token"])));
      }));
      fingerprint=AddLabel("Get a pairing code from Kavero, then confirm the matching fingerprint there.",28,253,604,58,9,Color.FromArgb(151,164,187));
      resetLink=new LinkLabel {Text="Reset connection",Location=new Point(488,302),Size=new Size(144,22),LinkColor=Color.FromArgb(173,182,200),ActiveLinkColor=ForeColor,VisitedLinkColor=Color.FromArgb(173,182,200),Font=new Font("Segoe UI",9)};resetLink.LinkClicked+=async(sender,args)=>await Run(async()=>{if(MessageBox.Show(this,"Revoke this computer in Kavero first. Reset then forgets its local connection after accepted work has recovered. Models and files are kept.","Reset connection",MessageBoxButtons.OKCancel)!=DialogResult.OK)return;ShowState(await Send("reset-connection"));});Controls.Add(resetLink);
      AddLabel("Image model on this PC",28,326,604,25,13,ForeColor);
      profiles=new ComboBox {Location=new Point(28,364),Size=new Size(294,30),DropDownStyle=ComboBoxStyle.DropDownList,BackColor=Color.FromArgb(29,33,43),ForeColor=ForeColor,AccessibleName="Image model"};profiles.Items.AddRange(new object[]{"Qwen Image 2.1 · Q4","Qwen Image 2.1 · Q3"});profiles.SelectedIndex=0;Controls.Add(profiles);
      setupButton=ActionButton("Review & set up",334,359,172,()=>Run(ReviewModel));
      cancelSetupButton=ActionButton("Cancel download",508,359,124,()=>Run(async()=>ShowState(await Send("cancel-setup"))));
      modelState=AddLabel("Model terms and hardware readiness are checked before setup.\nInference runs here; files save to your Kavero storage destination.",28,408,604,62,9,Color.FromArgb(151,164,187));
      ActionButton("Open Kavero",28,503,144,async()=>{try{Process.Start(new ProcessStartInfo(Publisher.Origin){UseShellExecute=true});}catch{MessageBox.Show(this,"Open "+Publisher.Origin+" in your browser.");}await Task.CompletedTask;});
      pauseResumeButton=ActionButton("Resume",184,503,128,()=>Run(async()=>ShowState(await Send(pausedNow?"resume":"pause"))));
      disconnectButton=ActionButton("Disconnect",324,503,144,()=>Run(async()=>ShowState(await Send("disconnect"))));
      quitButton=ActionButton("Quit",536,503,96,RequestQuit);
      var help=new ToolTip();help.SetToolTip(quitButton,"Pause new jobs and close. Pairing and unfinished work are kept for reopening.");Disposed+=(sender,args)=>help.Dispose();
      AddLabel("Manual launch · No automatic startup · "+(Publisher.Channel=="developer"?"Unsigned developer preview":"Preview"),28,554,604,20,8,Color.FromArgb(130,140,160));
      settingsToggle=new CheckBox {Text="Settings",Location=new Point(530,25),Size=new Size(102,24),ForeColor=ForeColor,AccessibleName="Companion settings"};settingsToggle.CheckedChanged+=(sender,args)=>ApplyActions();Controls.Add(settingsToggle);
      code.TextChanged+=(sender,args)=>ApplyActions();profiles.SelectedIndexChanged+=(sender,args)=>ApplyActions();ApplyActions();
      refresh=new Timer {Interval=5000};refresh.Tick+=async(sender,args)=>{if(!busy&&session!=null)await Run(async()=>ShowState(await Send("status")),false);};
      Shown+=async(sender,args)=>await Run(async()=>{var opened=await Task.Run(()=>new ControllerSession(installation));if(closing||IsDisposed){opened.Dispose();return;}session=opened;ShowState(session.Initial);refresh.Start();});
      FormClosing+=(sender,args)=>{closing=true;refresh.Stop();};
      FormClosed+=(sender,args)=>{refresh.Stop();refresh.Dispose();if(session!=null)session.Dispose();};
    }
    Label AddLabel(string text,int x,int y,int width,int height,int size,Color color){var label=new Label {Text=text,Location=new Point(x,y),Size=new Size(width,height),Font=new Font("Segoe UI",size),ForeColor=color};Controls.Add(label);return label;}
    Button ActionButton(string text,int x,int y,int width,Func<Task> action){var b=new Button {Text=text,UseMnemonic=false,Location=new Point(x,y),Size=new Size(width,38),FlatStyle=FlatStyle.Flat,BackColor=Color.FromArgb(29,33,43),ForeColor=ForeColor,Cursor=Cursors.Hand};b.FlatAppearance.BorderSize=0;b.Click+=async(sender,args)=>await action();Controls.Add(b);return b;}
    Task<Dictionary<string,object>> Send(string command,params string[] arguments){Format.Require(session!=null,"controller-disconnected");return Task.Run(()=>session.Command(command,arguments));}
    void ShowState(Dictionary<string,object> value){
      if(closing||IsDisposed)return;
      snapshot=value;bool paired=(bool)value["paired"],approved=(bool)value["approved"],paused=(bool)value["paused"];pausedNow=paused;
      bool ready=value["model"]!=null&&(bool)Format.Object(value["model"])["ready"];
      state.Text=!paired?"Connect your computer.":!approved?"Confirm your account.":value["error"]!=null?"Connection needs attention.":!ready?"Set up an image model.":paused?"Paused on this computer.":"Ready for Kavero.";
      detail.Text=Publisher.Origin+"\n"+(approved?"Paired account: "+Format.Text(value["owner"]):paired?"Confirm the fingerprint in Kavero, then allow the account here.":"Connect your signed-in Kavero account to get started.");
      if(value["fingerprint"]!=null)fingerprint.Text="Fingerprint\n"+Format.Text(value["fingerprint"]);
      if(value["model"]!=null){var m=Format.Object(value["model"]);modelState.Text=(bool)m["ready"]?"Model ready on this PC. Resume when you want to accept image jobs.":((bool)m["supported"]?"Compatible hardware":"Hardware check: "+Format.Text(m["compatibility"]));modelState.Text+="\nComponents: "+GiB(m["downloadBytes"])+" GB · Disk needed: "+GiB(m["requiredFreeBytes"])+" GB · Free: "+GiB(m["freeBytes"])+" GB";if(m["operation"]!=null){var op=Format.Object(m["operation"]);modelState.Text+="\nSetup: "+Format.Text(op["state"]);}}
      else modelState.Text="Model permission is separate from pairing. Review the model to check setup.\nInference runs here; files save to your Kavero storage destination.";
      if(value["job"]!=null){var job=Format.Object(value["job"]);modelState.Text+="\nJob: "+Format.Text(job["state"]);}
      if(value.ContainsKey("remoteSetup")&&value["remoteSetup"]!=null){var request=Format.Object(value["remoteSetup"]);if(!(bool)request["settled"])modelState.Text="Website setup: "+Format.Text(request["state"])+"\n"+((bool)request["needsApproval"]?"Review this request and its terms on this computer.":"Original installation is retained for recovery.");}
      if(value["error"]!=null)detail.Text+="\n"+Explain(Format.Text(value["error"]));
      ApplyActions();
    }
    void ApplyActions(){
      if(closing||IsDisposed)return;
      bool known=snapshot!=null,paired=known&&(bool)snapshot["paired"],approved=known&&(bool)snapshot["approved"];
      var model=known&&snapshot["model"]!=null?Format.Object(snapshot["model"]):null;
      var operation=model!=null&&model["operation"]!=null?Format.Object(model["operation"]):null;
      string phase=operation==null?"":Format.Text(operation["state"]);
      bool downloading=new[]{"admitted","downloading","verifying","staged","cancelling","activating"}.Contains(phase);
      var remote=known&&snapshot.ContainsKey("remoteSetup")&&snapshot["remoteSetup"]!=null?Format.Object(snapshot["remoteSetup"]):null;
      bool remoteActive=remote!=null&&!(bool)remote["settled"],reviewRemote=remoteActive&&(bool)remote["needsApproval"];
      if(remoteActive)profiles.SelectedIndex=Format.Text(remote["profile"])=="qwen-image-2.1-q3-evaluation"?1:0;
      connectionTitle.Text=approved?"Connected account":paired?"Account confirmation":"Connect this computer";connectedLabel.Visible=approved;
      code.Visible=pairButton.Visible=known&&!paired;code.Enabled=!busy;
      pairButton.Enabled=!busy&&System.Text.RegularExpressions.Regex.IsMatch(code.Text.Trim().Replace("-",""),"^[a-fA-F0-9]{24}$");
      approveButton.Visible=paired&&!approved;approveButton.Enabled=!busy;
      fingerprint.Visible=paired&&!approved||settingsToggle.Checked;
      resetLink.Visible=paired&&settingsToggle.Checked;resetLink.Enabled=!busy;
      profiles.Visible=approved;profiles.Enabled=!busy&&!downloading&&!remoteActive;
      setupButton.Visible=approved;setupButton.Enabled=!busy&&!downloading&&(!remoteActive||reviewRemote);
      setupButton.Text=downloading?"Downloading…":new[]{"failed","interrupted","activation-failed"}.Contains(phase)?"Retry setup":model!=null&&(bool)model["ready"]?"Review model":"Review & set up";
      if(remoteActive)setupButton.Text=reviewRemote?"Review request":"Website setup";
      cancelSetupButton.Visible=approved&&downloading&&!new[]{"activating","cancelling"}.Contains(phase);cancelSetupButton.Enabled=!busy;
      if(remoteActive)cancelSetupButton.Visible=approved&&!(bool)remote["cancelRequested"];
      pauseResumeButton.Visible=approved;pauseResumeButton.Text=pausedNow?"Resume":"Pause";
      pauseResumeButton.Enabled=!busy&&(!pausedNow||model!=null&&(bool)model["ready"]);
      disconnectButton.Visible=paired;disconnectButton.Enabled=!busy;
      quitButton.Enabled=true;
    }
    async Task ReviewModel(){
      string profile=profiles.SelectedIndex==1?"qwen-image-2.1-q3-evaluation":"qwen-image-2.1-q4-evaluation";
      bool remoteActive=snapshot!=null&&snapshot.ContainsKey("remoteSetup")&&snapshot["remoteSetup"]!=null&&!(bool)Format.Object(snapshot["remoteSetup"])["settled"];
      var result=remoteActive?await Send("review-remote-setup"):await Send("model","profile",profile);if(closing)return;ShowState(result);var terms=Format.Object(result["terms"]);var model=Format.Object(terms["model"]);bool allowed=(bool)model["supported"]&&!(bool)model["switchRequired"]&&((bool)model["available"]||(bool)model["ready"]);var content="Purpose: "+Format.Text(terms["purpose"])+"\r\nComponents: "+GiB(model["downloadBytes"])+" GB (cached files are reused). Disk needed: "+GiB(model["requiredFreeBytes"])+" GB.\r\n"+(allowed?"Review all component terms before continuing.":"Setup is currently unavailable. Review hardware, active model and setup status.")+"\r\n\r\n";
      if(remoteActive){var request=Format.Object(terms["remote"]);content="Website: "+Format.Text(request["origin"])+"\r\nAccount: "+Format.Text(request["owner"])+"\r\nModel: "+Format.Text(request["profile"])+"\r\nTarget: this computer\r\nFingerprint: "+Format.Text(snapshot["fingerprint"])+"\r\nRequest: "+Format.Text(request["id"])+"\r\n\r\n"+content;}
      foreach(var item in (object[])terms["notices"]){var notice=Format.Object(item);content+=Format.Text(notice["name"])+"\r\n"+Format.Text(notice["text"])+"\r\n\r\n";}
      using(var dialog=new Form {Text="Review model and component terms",Size=new Size(790,650),StartPosition=FormStartPosition.CenterParent,BackColor=BackColor,ForeColor=ForeColor,Font=Font}){
        var body=new TextBox {Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,WordWrap=true,Dock=DockStyle.Fill,Text=content,BackColor=BackColor,ForeColor=ForeColor,Font=new Font("Segoe UI",10)};
        var bottom=new Panel {Dock=DockStyle.Bottom,Height=98};var consent=new CheckBox {Text="I accept these terms for research/evaluation.",Location=new Point(16,10),Size=new Size(710,28)};
        var accept=new Button {Text="Accept & set up",UseMnemonic=false,Enabled=false,DialogResult=DialogResult.OK,Location=new Point(16,48),Size=new Size(180,34)};consent.CheckedChanged+=(sender,args)=>accept.Enabled=consent.Checked&&allowed;bottom.Controls.Add(consent);bottom.Controls.Add(accept);dialog.Controls.Add(body);dialog.Controls.Add(bottom);
        if(dialog.ShowDialog(this)==DialogResult.OK)ShowState(await Send(remoteActive?"accept-remote-setup":"accept-model","token",Format.Text(terms["token"])));
      }
    }
    static string GiB(object bytes){return (Convert.ToDouble(bytes)/(1024*1024*1024)).ToString("0.0");}
    Task RequestQuit(){if(!closing){closing=true;refresh.Stop();Close();}return Task.CompletedTask;}
    async Task Run(Func<Task> action,bool showError=true){if(busy||closing)return;busy=true;ApplyActions();foreach(var b in Controls.OfType<Button>())if(b!=quitButton)b.Enabled=false;try{await action();}catch(Exception error){if(showError&&!closing&&!IsDisposed)MessageBox.Show(this,Explain(error.Message),"Kavero Connect",MessageBoxButtons.OK,MessageBoxIcon.Information);}finally{busy=false;if(!closing&&!IsDisposed)ApplyActions();}}
    static string Explain(string code){
      switch(code){
        case "connect-drain-pending":return "Accepted work or result transfer still needs recovery. Keep this window open, cancel waiting jobs in Kavero if needed, then retry. New jobs are paused.";
        case "connect-recovery-required":return "The website or local engine is unavailable. Retry when it is online, or Quit and reopen later. Pairing and unfinished work are kept.";
        case "connect-setup-busy":return "Model setup is still active. Wait for it to finish or cancel setup, then retry.";
        case "connect-authorization-failed":return "Confirm this computer on the Kavero website. If it was revoked, recover accepted work, then use Reset connection before pairing again.";
        case "controller-timeout":case "controller-disconnected":case "controller-protocol-invalid":return "The desktop connection stopped. Accepted work and results are kept. Close and reopen the companion to recover the original jobs.";
        case "connect-local-owner-approval-required":return "Pair this computer, confirm its fingerprint on the website, then confirm the account here.";
        case "connect-model-not-ready":return "Set up and approve a compatible image model before resuming.";
        case "connect-model-switch-unavailable":return "This preview keeps the active model fixed. Switching an installed model needs a coordinated activation and is not available here yet.";
        case "connect-approval-stale":case "connect-model-changed":return "The approval has changed or expired. Review it again.";
        case "connect-code-invalid":return "Enter the 24-character pairing code from Kavero.";
        case "connect-revoke-first":return "This connection is still authorized. Revoke the computer on the Kavero website before resetting it here.";
        default:return "The companion could not complete this action. Your files and original jobs are kept. Check the connection and retry. If local Docker or another native host is running, close it with its original launcher first.";
      }
    }
  }
}
