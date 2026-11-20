using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Kavero.Connect {
  internal sealed class ControllerRejectedException:IOException {internal ControllerRejectedException(string code):base(code){}}
  // One inherited private stdio channel. No ports, command arguments or remote
  // executable/config paths are accepted from the website.
  internal sealed class ControllerSession:IDisposable {
    Process child;VerifiedFiles verified;FileStream launcher;int sequence;bool disposed;readonly object gate=new object();
    internal Dictionary<string,object> Initial;
    internal bool Broken {get{return disposed;}}
    internal ControllerSession(Installation installation) {
      installation.ValidateCurrent();verified=TrustedPackage.Directory(installation.Payload);
      try {
        Format.Require(verified.Release.Digest==installation.Release.Digest,"release-changed");launcher=SafeFiles.Read(installation.Launcher);
        var start=new ProcessStartInfo(SafeFiles.Child(installation.Payload,"runtime/node.exe"),Installation.Quote(SafeFiles.Child(installation.Payload,"scripts/local-generation/connect/package/controller.mjs")));
        start.UseShellExecute=false;start.CreateNoWindow=true;start.WindowStyle=ProcessWindowStyle.Hidden;start.WorkingDirectory=installation.VersionRoot;start.RedirectStandardInput=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;start.StandardOutputEncoding=Format.Utf8;start.StandardErrorEncoding=Format.Utf8;
        foreach(var key in start.EnvironmentVariables.Keys.Cast<string>().Where(k=>k.StartsWith("NODE_",StringComparison.OrdinalIgnoreCase)).ToArray())start.EnvironmentVariables.Remove(key);
        // Only Windows utilities used for DPAPI, ACLs and verified PID identity.
        var windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows);start.EnvironmentVariables["PATH"]=Path.Combine(windows,"System32")+";"+Path.Combine(windows,"System32","WindowsPowerShell","v1.0");
        child=new Process {StartInfo=start,EnableRaisingEvents=true};child.Exited+=(sender,args)=>ReleaseFiles();child.Start();
        // Drain, never display arbitrary stderr, prompts or native paths.
        Task.Run(()=>{var discard=new char[2048];try{while(child.StandardError.Read(discard,0,discard.Length)>0){}}catch{}});
        var input=new Dictionary<string,object>{{"channel",Publisher.Channel},{"config",installation.Binding},{"localAppData",installation.LocalData},{"trust",new object[]{new Dictionary<string,object>{{"id",Publisher.KeyId},{"channel",Publisher.Channel},{"publicKey",Publisher.Pem}}}}};
        child.StandardInput.WriteLine(Format.Canonical(input));child.StandardInput.Flush();Initial=Read(0);
      }catch{Dispose();throw;}
    }
    Dictionary<string,object> Read(int id) {
      var read=Task.Run(()=>{var line=new StringBuilder();int c;while((c=child.StandardOutput.Read())!=-1){if(c=='\n')return line.ToString();Format.Require(line.Length<1024*1024,"controller-output-limit");line.Append((char)c);}throw new IOException("controller-disconnected");});
      Format.Require(read.Wait(180000),"controller-timeout");var reply=Format.Object(new JavaScriptSerializer {MaxJsonLength=1024*1024,RecursionLimit=32}.DeserializeObject(read.Result));
      Format.Require(reply.ContainsKey("id")&&Format.Number(reply["id"])==id&&reply.ContainsKey("ok")&&reply["ok"] is bool,"controller-protocol-invalid");
      if(!(bool)reply["ok"])throw new ControllerRejectedException(Format.Text(reply["error"]));return Format.Object(reply["value"]);
    }
    internal Dictionary<string,object> Command(string command,params string[] arguments) {
      lock(gate){Format.Require(!disposed&&!child.HasExited,"controller-disconnected");var input=new Dictionary<string,object>{{"command",command}};Format.Require(arguments.Length%2==0,"controller-command-invalid");for(int i=0;i<arguments.Length;i+=2)input.Add(arguments[i],arguments[i+1]);
        try{int id=++sequence;child.StandardInput.WriteLine(Format.Canonical(new Dictionary<string,object>{{"id",id},{"input",input}}));child.StandardInput.Flush();return Read(id);}catch(ControllerRejectedException){throw;}catch{Dispose();throw;}}
    }
    void ReleaseFiles(){lock(this){if(verified!=null){verified.Dispose();verified=null;}if(launcher!=null){launcher.Dispose();launcher=null;}}}
    public void Dispose(){if(disposed)return;disposed=true;if(child==null){ReleaseFiles();return;}try{child.StandardInput.Close();}catch{}if(child.HasExited)ReleaseFiles();
      // Never kill inference or discard its unknown receipt. EOF stops admissions
      // and the child releases protected code handles only after safe recovery.
    }
  }
}
