using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Threading;

namespace Kavero.Connect {
  internal sealed class Installation:IDisposable {
    internal readonly string Root,LocalData,Self;internal Release Release;
    internal Dictionary<string,object> Binding;
    Mutex gate;bool owned;string sid;
    internal Installation() {
      Format.Require(Environment.Is64BitOperatingSystem&&Environment.Is64BitProcess&&Environment.OSVersion.Platform==PlatformID.Win32NT,"windows-x64-required");
      LocalData=Environment.GetEnvironmentVariable("LOCALAPPDATA");Format.Require(!String.IsNullOrEmpty(LocalData)&&Path.IsPathRooted(LocalData),"local-data-unavailable");
      Root=Path.Combine(LocalData,"Kavero","Connect","apps",Publisher.Channel,Format.Hash(Format.Utf8.GetBytes(Publisher.Origin)).Substring(0,32));
      Self=Assembly.GetExecutingAssembly().Location;sid=WindowsIdentity.GetCurrent().User.Value;
      // The kernel lock is per account/channel/origin and shared by installer,
      // installed window, diagnostics and code removal. No arbitrary lock name.
      var security=new MutexSecurity();security.SetAccessRuleProtection(true,false);security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(sid),MutexRights.FullControl,AccessControlType.Allow));
      bool created;gate=new Mutex(false,"Global\\KaveroConnect-"+Format.Hash(Format.Utf8.GetBytes(sid+Root.ToLowerInvariant())),out created,security);
      try{owned=gate.WaitOne(0);}catch(AbandonedMutexException){owned=true;}Format.Require(owned,"companion-already-open");
    }
    internal static void PrivateDirectory(string path) {
      SafeFiles.Ancestors(path);Directory.CreateDirectory(path);var sid=WindowsIdentity.GetCurrent().User;var security=new DirectorySecurity();security.SetOwner(sid);security.SetAccessRuleProtection(true,false);security.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(path,security);SafeFiles.Ancestors(path);
    }
    internal static byte[] Read(string path,int limit){using(var file=SafeFiles.Read(path))return Format.Read(file,limit);}
    internal static void WriteNew(string path,byte[] bytes){SafeFiles.Ancestors(path);using(var file=new FileStream(path,FileMode.CreateNew,FileAccess.Write,FileShare.None)){file.Write(bytes,0,bytes.Length);file.Flush(true);}}
    internal static void Atomic(string path,object value) {var temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";WriteNew(temp,Format.Utf8.GetBytes(Format.Canonical(value)));if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);}
    internal Stream Bundle(){var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("KaveroPayload.zip");Format.Require(resource!=null&&resource.Length<=128*1024*1024,"bundle-limit");return resource;}
    internal Release Inspect(){using(var resource=Bundle())using(var zip=new ZipArchive(resource,ZipArchiveMode.Read)){Release=TrustedPackage.Archive(zip);return Release;}}
    internal bool Present {get{SafeFiles.Ancestors(Root);return File.Exists(Path.Combine(Root,"current.json"));}}
    void LoadBinding(bool create) {
      SafeFiles.Ancestors(Root);var marker=Path.Combine(Root,"owner.json");var binding=Path.Combine(Root,"binding.json");
      if(!Directory.Exists(Root)){Format.Require(create,"not-installed");PrivateDirectory(Root);}
      if(!File.Exists(marker)) {
        Format.Require(create&&Directory.GetFileSystemEntries(Root).Length==0,"installation-not-owned");
        Binding=new Dictionary<string,object>{{"schema",1},{"protocol",1},{"installationId",Guid.NewGuid().ToString()},{"channel",Publisher.Channel},{"origin",Publisher.Origin}};
        WriteNew(marker,Format.Utf8.GetBytes(Format.Canonical(new Dictionary<string,object>{{"schema",1},{"sid",sid},{"origin",Publisher.Origin},{"channel",Publisher.Channel},{"installationId",Binding["installationId"]}})));
        WriteNew(binding,Format.Utf8.GetBytes(Format.Canonical(Binding)));
      }
      var owner=Format.Object(Format.Json.DeserializeObject(Format.Utf8.GetString(Read(marker,4096))));Format.Keys(owner,"schema","sid","origin","channel","installationId");Format.Require(Format.Number(owner["schema"])==1&&Format.Text(owner["sid"])==sid&&Format.Text(owner["origin"])==Publisher.Origin&&Format.Text(owner["channel"])==Publisher.Channel,"installation-not-owned");
      Format.Require(File.Exists(binding),"installation-config-missing");Binding=Format.Object(Format.Json.DeserializeObject(Format.Utf8.GetString(Read(binding,4096))));Format.Keys(Binding,"schema","protocol","installationId","channel","origin");Guid uuid;
      Format.Require(Format.Number(Binding["schema"])==1&&Format.Number(Binding["protocol"])==1&&Guid.TryParseExact(Format.Text(Binding["installationId"]),"D",out uuid)&&Format.Text(Binding["installationId"])==Format.Text(owner["installationId"])&&Format.Text(Binding["channel"])==Publisher.Channel&&Format.Text(Binding["origin"])==Publisher.Origin,"installation-config-changed");
    }
    internal string VersionRoot {get{return Path.Combine(Root,"versions",Release.Digest.Substring(0,32));}}
    internal string Payload {get{return Path.Combine(VersionRoot,"payload");}}
    internal string Launcher {get{return Path.Combine(VersionRoot,"KaveroConnect.exe");}}
    internal void Install() {
      Inspect();LoadBinding(true);
      if(Present){ValidateCurrent();using(var files=TrustedPackage.Directory(Payload))Format.Require(files.Release.Digest==Release.Digest,"different-version-installed");using(var source=SafeFiles.Read(Self))using(var installed=SafeFiles.Read(Launcher))Format.Require(Format.Hash(source)==Format.Hash(installed),"different-launcher-installed");return;}
      var versions=Path.Combine(Root,"versions");SafeFiles.Ancestors(versions);if(Directory.Exists(versions))Format.Require(Directory.GetFileSystemEntries(versions).Length==0,"interrupted-installation");else Directory.CreateDirectory(versions);
      Format.Require(Directory.GetDirectories(Root,"staging-*").Length==0,"interrupted-installation");var staging=Path.Combine(Root,"staging-"+Guid.NewGuid().ToString("N"));PrivateDirectory(staging);var payload=Path.Combine(staging,"payload");Directory.CreateDirectory(payload);
      // Never recursively delete a failed stage automatically. Its identity and
      // failure remain visible for explicit recovery; no old version is replaced.
      using(var resource=Bundle())using(var zip=new ZipArchive(resource,ZipArchiveMode.Read)){
        var validated=TrustedPackage.Archive(zip);Format.Require(validated.Digest==Release.Digest,"bundle-changed");
        foreach(var entry in zip.Entries){var output=SafeFiles.Child(payload,entry.FullName);Directory.CreateDirectory(Path.GetDirectoryName(output));using(var source=entry.Open())using(var target=new FileStream(output,FileMode.CreateNew,FileAccess.Write,FileShare.None)){var buffer=new byte[65536];long total=0;int count;while((count=source.Read(buffer,0,buffer.Length))>0){total+=count;Format.Require(total<=entry.Length,"extraction-limit");target.Write(buffer,0,count);}Format.Require(total==entry.Length,"extraction-short");target.Flush(true);}}
      }
      using(var files=TrustedPackage.Directory(payload))Format.Require(files.Release.Digest==Release.Digest,"staging-changed");
      string launcherHash;using(var source=SafeFiles.Read(Self))using(var target=new FileStream(Path.Combine(staging,"KaveroConnect.exe"),FileMode.CreateNew,FileAccess.Write,FileShare.None)){launcherHash=Format.Hash(source);source.Position=0;source.CopyTo(target);target.Flush(true);}
      SafeFiles.Ancestors(versions);Format.Require(!Directory.Exists(VersionRoot),"version-already-present");Directory.Move(staging,VersionRoot);
      Atomic(Path.Combine(Root,"current.json"),new Dictionary<string,object>{{"schema",1},{"release",Release.Digest},{"launcherSha256",launcherHash}});
    }
    internal void ValidateCurrent() {
      LoadBinding(false);Format.Require(Present,"not-installed");var current=Format.Object(Format.Json.DeserializeObject(Format.Utf8.GetString(Read(Path.Combine(Root,"current.json"),4096))));Format.Keys(current,"schema","release","launcherSha256");
      Format.Require(Format.Number(current["schema"])==1&&Format.Text(current["release"])==Release.Digest,"different-version-installed");
      using(var file=SafeFiles.Read(Launcher))Format.Require(Format.Hash(file)==Format.Text(current["launcherSha256"]),"launcher-changed");
      // No unlisted executable may be added beside the protected payload.
      Format.Require(Directory.GetFileSystemEntries(VersionRoot).Select(Path.GetFileName).OrderBy(x=>x).SequenceEqual(new[]{"KaveroConnect.exe","payload"}.OrderBy(x=>x)),"extra-version-content");
    }
    internal bool RunningInstalled {get{return String.Equals(Path.GetFullPath(Self),Path.GetFullPath(Launcher),StringComparison.OrdinalIgnoreCase);}}
    internal object Diagnostic() {
      if(Release==null)Inspect();ValidateCurrent();
      using(var files=TrustedPackage.Directory(Payload))using(var launcher=SafeFiles.Read(Launcher)){
        Format.Require(files.Release.Digest==Release.Digest,"release-changed");
        var start=new ProcessStartInfo(SafeFiles.Child(Payload,"runtime/node.exe"),Quote(SafeFiles.Child(Payload,"scripts/local-generation/connect/package/installed.mjs")));
        start.UseShellExecute=false;start.CreateNoWindow=true;start.WindowStyle=ProcessWindowStyle.Hidden;start.WorkingDirectory=VersionRoot;start.RedirectStandardInput=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
        foreach(var key in start.EnvironmentVariables.Keys.Cast<string>().Where(k=>k.StartsWith("NODE_",StringComparison.OrdinalIgnoreCase)).ToArray())start.EnvironmentVariables.Remove(key);start.EnvironmentVariables["PATH"]="";
        var input=new Dictionary<string,object>{{"channel",Publisher.Channel},{"config",Binding},{"localAppData",LocalData},{"trust",new object[]{new Dictionary<string,object>{{"id",Publisher.KeyId},{"channel",Publisher.Channel},{"publicKey",Publisher.Pem}}}}};
        var output=new StringBuilder();int errorSize=0;bool overflow=false;
        using(var child=new Process {StartInfo=start}){
          child.OutputDataReceived+=(sender,args)=>{if(args.Data==null)return;lock(output){if(output.Length+args.Data.Length>8192)overflow=true;else output.AppendLine(args.Data);}};
          child.ErrorDataReceived+=(sender,args)=>{if(args.Data==null)return;lock(output){errorSize+=args.Data.Length;if(errorSize>8192)overflow=true;}};
          child.Start();child.BeginOutputReadLine();child.BeginErrorReadLine();
          try{child.StandardInput.Write(Format.Canonical(input));child.StandardInput.Close();if(!child.WaitForExit(30000)){child.Kill();child.WaitForExit();throw new IOException("diagnostic-timeout");}child.WaitForExit();Format.Require(!overflow&&child.ExitCode==0,"diagnostic-failed");}
          finally{if(!child.HasExited){child.Kill();child.WaitForExit();}}
        }
        var result=Format.Object(Format.Json.DeserializeObject(output.ToString()));Format.Require(result.ContainsKey("installed")&&result["installed"] is bool&&(bool)result["installed"]&&result.ContainsKey("hostStarted")&&result["hostStarted"] is bool&&!(bool)result["hostStarted"]&&Format.Text(result["channel"])==Publisher.Channel,"diagnostic-invalid");
        Atomic(Path.Combine(Root,"last-diagnostic.json"),result);return result;
      }
    }
    internal void Open() {Inspect();ValidateCurrent();using(var files=TrustedPackage.Directory(Payload)){Format.Require(files.Release.Digest==Release.Digest,"release-changed");}Format.Require(!RunningInstalled,"already-installed-window");Dispose();Process.Start(new ProcessStartInfo(Launcher){UseShellExecute=false});}
    internal void RemoveCode() {
      Inspect();ValidateCurrent();Format.Require(!RunningInstalled,"close-installed-app-first");
      // Fully verify the exact known tree before deletion, then release read
      // handles. Kernel ownership excludes installer/launcher races.
      using(var files=TrustedPackage.Directory(Payload))Format.Require(files.Release.Digest==Release.Digest,"release-changed");
      var relativeFiles=Release.Files.Select(f=>f.Path).Concat(new[]{"release.json"}).ToArray();
      foreach(var name in relativeFiles){var target=SafeFiles.Child(Payload,name);using(var file=SafeFiles.Read(target)){}File.Delete(target);}
      var dirs=Directory.GetDirectories(Payload,"*",SearchOption.AllDirectories).OrderByDescending(p=>p.Length).ToArray();foreach(var dir in dirs){SafeFiles.Ancestors(dir);Directory.Delete(dir,false);}Directory.Delete(Payload,false);
      SafeFiles.Ancestors(Launcher);File.Delete(Launcher);Directory.Delete(VersionRoot,false);File.Delete(Path.Combine(Root,"current.json"));
      // owner/binding, stable native host, identity and outputs are retained.
    }
    internal string Notices() {
      Inspect();var text=new StringBuilder();using(var resource=Bundle())using(var zip=new ZipArchive(resource,ZipArchiveMode.Read))foreach(var file in Release.Files.Where(f=>f.Path=="LICENSE"||f.Path.IndexOf("notice",StringComparison.OrdinalIgnoreCase)>=0||f.Path.EndsWith(".md",StringComparison.OrdinalIgnoreCase))){Format.Require(file.Bytes<=1024*1024,"notice-limit");using(var stream=zip.GetEntry(file.Path).Open()){text.AppendLine(file.Path);text.AppendLine(new string('-',60));text.AppendLine(Format.Utf8.GetString(Format.Read(stream,1024*1024)));text.AppendLine();}}return text.ToString();
    }
    internal static string Quote(string value){Format.Require(value.IndexOf('"')<0&&!value.EndsWith("\\"),"invalid-process-argument");return "\""+value+"\"";}
    public void Dispose(){if(gate!=null){if(owned){gate.ReleaseMutex();owned=false;}gate.Dispose();gate=null;}}
  }
}
