// Hidden native lifecycle regression harness; excluded from shipped sources.
using System;
using System.Linq;
using System.Reflection;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
namespace Kavero.Connect {
  internal static class Publisher {internal const string Channel="developer",Origin="http://127.0.0.1:3061";}
  internal sealed class Installation {}
  internal static class Format {
    internal static void Require(bool ok,string code){if(!ok)throw new Exception(code);}
    internal static string Text(object value){return Convert.ToString(value);}
    internal static Dictionary<string,object> Object(object value){return (Dictionary<string,object>)value;}
  }
  internal sealed class ControllerSession:IDisposable {
    internal static readonly ManualResetEvent OpenGate=new ManualResetEvent(true);
    internal static int Opened,Disposed;
    internal ControllerSession(Installation installation){Interlocked.Increment(ref Opened);OpenGate.WaitOne();}
    internal Dictionary<string,object> Initial {get{return new Dictionary<string,object>{{"paired",false},{"approved",false},{"paused",true},{"owner",null},{"fingerprint",null},{"error",null},{"model",null},{"job",null}};}}
    internal Dictionary<string,object> Command(string command,params string[] args){throw new Exception("offline");}
    public void Dispose(){Interlocked.Increment(ref Disposed);}
  }
  internal static class LifecycleHarness {
    static MethodInfo Method(string name){return typeof(CompanionForm).GetMethod(name,BindingFlags.Instance|BindingFlags.NonPublic);}
    static void Check(bool ok,string code){if(!ok)throw new Exception(code);}
    static Dictionary<string,object> View(bool paired,bool approved,bool paused,bool ready,string phase){return new Dictionary<string,object>{
      {"paired",paired},{"approved",approved},{"paused",paused},{"owner",null},{"fingerprint",null},{"error",null},{"job",null},
      {"model",approved?new Dictionary<string,object>{{"ready",ready},{"supported",true},{"compatibility","eligible"},{"downloadBytes",1024},{"requiredFreeBytes",2048},{"freeBytes",4096},{"operation",phase==null?null:new Dictionary<string,object>{{"state",phase}}}}:null}};}
    static void Pump(Func<bool> done){var until=DateTime.UtcNow.AddSeconds(5);while(!done()&&DateTime.UtcNow<until){Application.DoEvents();Thread.Sleep(5);}Check(done(),"continuation-timeout");}
    [STAThread] static int Main(){try{
      Application.EnableVisualStyles();
      using(var actions=new CompanionForm(null)){
        actions.Opacity=0;actions.Show();Application.DoEvents();
        Pump(()=>typeof(CompanionForm).GetField("session",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(actions)!=null&&!(bool)typeof(CompanionForm).GetField("busy",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(actions));
        Method("ShowState").Invoke(actions,new object[]{View(false,false,true,false,null)});
        Check(actions.Controls.OfType<Button>().Single(b=>b.Text=="Connect").Visible,"unpaired-connect-hidden");
        Check(!actions.Controls.OfType<Button>().Single(b=>b.Text=="Confirm account").Visible,"unpaired-approval-visible");
        Method("ShowState").Invoke(actions,new object[]{View(true,false,true,false,null)});
        Check(!actions.Controls.OfType<Button>().Single(b=>b.Text=="Connect").Visible,"paired-connect-visible");
        Check(actions.Controls.OfType<Button>().Single(b=>b.Text=="Confirm account").Visible,"paired-approval-hidden");
        Method("ShowState").Invoke(actions,new object[]{View(true,true,true,true,"installed")});
        Check(actions.Controls.OfType<Button>().Single(b=>b.Text=="Resume").Enabled,"ready-resume-disabled");
        Check(!actions.Controls.OfType<Button>().Any(b=>b.Text=="Pause"),"simultaneous-pause-resume");
        Method("ShowState").Invoke(actions,new object[]{View(true,true,false,true,"installed")});
        Check(actions.Controls.OfType<Button>().Single(b=>b.Text=="Pause").Enabled,"active-pause-disabled");
        Method("ShowState").Invoke(actions,new object[]{View(true,true,true,false,"downloading")});
        Check(actions.Controls.OfType<Button>().Single(b=>b.Text=="Cancel download").Visible,"download-cancel-hidden");
        Check(!actions.Controls.OfType<Button>().Single(b=>b.Text=="Downloading…").Enabled,"download-duplicate-enabled");
        Check(!actions.Controls.OfType<Button>().Single(b=>b.Text=="Resume").Enabled,"unready-resume-enabled");
        Method("ShowState").Invoke(actions,new object[]{View(true,true,true,false,"interrupted")});
        Check(actions.Controls.OfType<Button>().Single(b=>b.Text=="Retry setup").Enabled,"retry-hidden");
        actions.Close();
      }
      ControllerSession.Opened=0;ControllerSession.Disposed=0;
      foreach(bool useQuit in new[]{true,false}){
        var form=new CompanionForm(null);var handle=form.Handle;
        var pending=new TaskCompletionSource<bool>();
        var running=(Task)Method("Run").Invoke(form,new object[]{new Func<Task>(async()=>{await pending.Task;throw new Exception("offline");}),false});
        var quit=form.Controls.OfType<Button>().Single(b=>b.Text=="Quit");Check(quit.Enabled,"quit-disabled-during-poll");
        if(useQuit)Method("RequestQuit").Invoke(form,null);else form.Close();
        Check(form.IsDisposed,"busy-window-did-not-close");pending.SetResult(true);Pump(()=>running.IsCompleted);Check(!running.IsFaulted,"late-poll-failed-after-close");
      }
      ControllerSession.OpenGate.Reset();var opening=new CompanionForm(null);var openingHandle=opening.Handle;
      typeof(Form).GetMethod("OnShown",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(opening,new object[]{EventArgs.Empty});
      Pump(()=>ControllerSession.Opened==1);opening.Close();Check(opening.IsDisposed,"opening-window-did-not-close");ControllerSession.OpenGate.Set();Pump(()=>ControllerSession.Disposed==1);
      Console.WriteLine("state-actions quit-during-poll window-close-during-poll late-startup-disposed");return 0;
    }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}}
  }
}
