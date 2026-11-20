using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using System.IO.Compression;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Kavero.Connect {
  // Trust constants are compiled by the build operator, never read from a package.
  internal sealed class ContentFile { public string Path, Hash; public long Bytes; }
  internal sealed class Release {
    public string Digest, Version; public Dictionary<string,object> Metadata;
    public List<ContentFile> Files = new List<ContentFile>();
  }
  internal static class Format {
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer {MaxJsonLength=65536,RecursionLimit=32};
    internal static readonly UTF8Encoding Utf8 = new UTF8Encoding(false,true);
    internal static void Require(bool condition,string code) {if(!condition)throw new InvalidDataException(code);}
    internal static Dictionary<string,object> Object(object value) {var d=value as Dictionary<string,object>;Require(d!=null,"invalid-object");return d;}
    internal static void Keys(Dictionary<string,object> d,params string[] keys) {Require(d.Keys.OrderBy(x=>x,StringComparer.Ordinal).SequenceEqual(keys.OrderBy(x=>x,StringComparer.Ordinal)),"invalid-fields");}
    internal static string Text(object value) {Require(value is string,"invalid-text");return (string)value;}
    internal static long Number(object value) {Require(value is int||value is long,"invalid-number");return Convert.ToInt64(value);}
    internal static string Canonical(object value) {
      var d=value as Dictionary<string,object>;
      if(d!=null)return "{"+String.Join(",",d.Keys.OrderBy(x=>x,StringComparer.Ordinal).Select(k=>Json.Serialize(k)+":"+Canonical(d[k])).ToArray())+"}";
      var list=value as IList;if(list!=null)return "["+String.Join(",",list.Cast<object>().Select(Canonical).ToArray())+"]";
      Require(value==null||value is string||value is bool||value is int||value is long,"invalid-json-value");return Json.Serialize(value);
    }
    internal static byte[] Decode(string value) {Require(value.Length<=60000&&System.Text.RegularExpressions.Regex.IsMatch(value,"^[A-Za-z0-9_-]+$"),"invalid-base64");var normalized=value.Replace('-','+').Replace('_','/');var bytes=Convert.FromBase64String(normalized.PadRight((normalized.Length+3)/4*4,'='));Require(Encode(bytes)==value,"invalid-base64");return bytes;}
    internal static string Encode(byte[] value) {return Convert.ToBase64String(value).TrimEnd('=').Replace('+','-').Replace('/','_');}
    internal static string Hash(byte[] value) {using(var sha=SHA256.Create())return Hex(sha.ComputeHash(value));}
    internal static string Hex(byte[] value) {return BitConverter.ToString(value).Replace("-","").ToLowerInvariant();}
    internal static string Hash(Stream value) {using(var sha=SHA256.Create())return Hex(sha.ComputeHash(value));}
    internal static byte[] Read(Stream stream,long limit) {
      using(var memory=new MemoryStream()){var chunk=new byte[65536];int read;long size=0;while((read=stream.Read(chunk,0,chunk.Length))>0){size+=read;Require(size<=limit,"content-limit");memory.Write(chunk,0,read);}return memory.ToArray();}
    }
    internal static void Relative(string path) {
      Require(path.Length>0&&path.Length<=180&&System.Text.RegularExpressions.Regex.IsMatch(path,"^[-a-zA-Z0-9_./]+$"),"unsafe-path");
      foreach(var part in path.Split('/'))Require(part.Length>0&&part!="."&&part!=".."&&!part.EndsWith(".")&&!System.Text.RegularExpressions.Regex.IsMatch(part,"^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase),"unsafe-path");
    }
  }
  internal static class SafeFiles {
    [StructLayout(LayoutKind.Sequential)] struct FileInformation { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write;public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle,out FileInformation info);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string path,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    internal static void Ancestors(string path) {
      for(var p=System.IO.Path.GetFullPath(path);p!=null;p=System.IO.Path.GetDirectoryName(p)) {
        if(File.Exists(p)||Directory.Exists(p))Format.Require((File.GetAttributes(p)&FileAttributes.ReparsePoint)==0,"unsafe-link");
        if(p==System.IO.Path.GetPathRoot(p))break;
      }
    }
    internal static FileStream Read(string path) {
      Ancestors(path);var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read);
      try{FileInformation info;Format.Require(GetFileInformationByHandle(stream.SafeFileHandle,out info)&&info.Links==1&&(info.Attributes&0x400)==0,"unsafe-link");Ancestors(path);return stream;}catch{stream.Dispose();throw;}
    }
    internal static SafeFileHandle HoldDirectory(string path) {Ancestors(path);var absolute=System.IO.Path.GetFullPath(path);var extended=absolute.StartsWith(@"\\")?@"\\?\UNC\"+absolute.Substring(2):@"\\?\"+absolute;var handle=CreateFile(extended,0x80,3,IntPtr.Zero,3,0x02000000,IntPtr.Zero);if(handle.IsInvalid){handle.Dispose();throw new IOException("directory-lock-failed");}return handle;}
    internal static string Child(string root,string relative) {Format.Relative(relative);var result=System.IO.Path.GetFullPath(System.IO.Path.Combine(root,relative.Replace('/',System.IO.Path.DirectorySeparatorChar)));Format.Require(result.StartsWith(System.IO.Path.GetFullPath(root)+System.IO.Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase),"unsafe-path");return result;}
  }
  internal sealed class VerifiedFiles:IDisposable {
    internal Release Release;internal List<IDisposable> Held=new List<IDisposable>();
    public void Dispose(){for(int i=Held.Count-1;i>=0;i--)Held[i].Dispose();Held.Clear();}
  }
  internal static class TrustedPackage {
    internal static Release Envelope(byte[] bytes) {
      Format.Require(bytes.Length<=65536,"manifest-limit");var raw=Format.Utf8.GetString(bytes);var envelope=Format.Object(Format.Json.DeserializeObject(raw));
      Format.Keys(envelope,"payload","keyId","signature");Format.Require(Format.Canonical(envelope)==raw,"noncanonical-envelope");
      Format.Require(Format.Text(envelope["keyId"])==Publisher.KeyId,"untrusted-publisher");
      var payload=Format.Decode(Format.Text(envelope["payload"]));var signature=Format.Decode(Format.Text(envelope["signature"]));
      Format.Require(signature.Length>=384&&signature.Length<=512,"invalid-signature");
      var prefix=Format.Utf8.GetBytes("kavero-connect-release-v1\n");var message=new byte[prefix.Length+payload.Length];Buffer.BlockCopy(prefix,0,message,0,prefix.Length);Buffer.BlockCopy(payload,0,message,prefix.Length,payload.Length);
      using(var rsa=new RSACng()){rsa.ImportParameters(new RSAParameters {Modulus=Format.Decode(Publisher.Modulus),Exponent=Format.Decode(Publisher.Exponent)});Format.Require(rsa.KeySize>=3072&&rsa.KeySize<=4096&&rsa.VerifyData(message,signature,HashAlgorithmName.SHA256,RSASignaturePadding.Pss),"invalid-signature");}
      var text=Format.Utf8.GetString(payload);var p=Format.Object(Format.Json.DeserializeObject(text));Format.Require(Format.Canonical(p)==text,"noncanonical-payload");
      Format.Keys(p,"schema","product","version","protocol","minimumLauncher","platform","arch","channel","origin","files");
      Format.Require(Format.Number(p["schema"])==1&&Format.Text(p["product"])=="kavero-connect"&&Format.Number(p["protocol"])==1&&Format.Number(p["minimumLauncher"])==1&&Format.Text(p["platform"])=="win32"&&Format.Text(p["arch"])=="x64","incompatible-package");
      Format.Require(Format.Text(p["channel"])==Publisher.Channel&&Format.Text(p["origin"])==Publisher.Origin,"package-binding-mismatch");
      var version=Format.Text(p["version"]);Format.Require(version.Length<=32&&System.Text.RegularExpressions.Regex.IsMatch(version,@"^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-(?:dev|rc)\.\d{1,5})?$"),"invalid-version");
      var files=p["files"] as IList;Format.Require(files!=null&&files.Count>=4&&files.Count<=256,"inventory-limit");
      var release=new Release {Metadata=p,Digest=Format.Hash(payload),Version=version};long total=0;string previous="";
      foreach(var value in files){var f=Format.Object(value);Format.Keys(f,"path","bytes","sha256");var name=Format.Text(f["path"]);Format.Relative(name);var lower=name.ToLowerInvariant();Format.Require(StringComparer.Ordinal.Compare(lower,previous)>0&&lower!="release.json"&&!System.Text.RegularExpressions.Regex.IsMatch(name,@"(?:^|/)(?:node_modules|\.env[^/]*|cleanup-results\.mjs)(?:/|$)|\.(?:test\.[^/]+|gguf|safetensors|sqlite|pem|key|dpapi)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase),"invalid-inventory-path");previous=lower;
        var size=Format.Number(f["bytes"]);var hash=Format.Text(f["sha256"]);Format.Require(size>0&&size<=96*1024*1024&&System.Text.RegularExpressions.Regex.IsMatch(hash,"^[a-f0-9]{64}$"),"invalid-file-identity");total+=size;release.Files.Add(new ContentFile {Path=name,Bytes=size,Hash=hash});}
      Format.Require(total<=128*1024*1024,"package-limit");
      RequireFile(release,"runtime/node.exe",Publisher.NodeBytes,Publisher.NodeHash);RequireFile(release,"notices/Node-LICENSE.txt",Publisher.NoticeBytes,Publisher.NoticeHash);
      foreach(var name in new[]{"LICENSE","scripts/local-generation/connect/package/diagnose.mjs","scripts/local-generation/connect/package/installed.mjs"})Format.Require(release.Files.Any(f=>f.Path==name),"missing-required-file");
      return release;
    }
    static void RequireFile(Release release,string name,long bytes,string hash){Format.Require(release.Files.Any(f=>f.Path==name&&f.Bytes==bytes&&f.Hash==hash),"runtime-pin-mismatch");}
    internal static Release Archive(ZipArchive archive) {
      Format.Require(archive.Entries.Count>=5&&archive.Entries.Count<=257,"archive-limit");var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;
      foreach(var entry in archive.Entries){Format.Relative(entry.FullName);Format.Require(names.Add(entry.FullName)&&entry.Length<=96*1024*1024,"archive-entry-invalid");var attributes=unchecked((uint)entry.ExternalAttributes);var unix=(attributes>>16)&0xf000;Format.Require((attributes&0x410)==0&&(unix==0||unix==0x8000),"archive-link");total+=entry.Length;Format.Require(total<=128*1024*1024+65536,"archive-limit");}
      var manifest=archive.GetEntry("release.json");Format.Require(manifest!=null&&manifest.Length<=65536,"manifest-missing");Release release;using(var stream=manifest.Open())release=Envelope(Format.Read(stream,65536));
      Format.Require(archive.Entries.Count==release.Files.Count+1,"inventory-mismatch");
      foreach(var f in release.Files){var entry=archive.GetEntry(f.Path);Format.Require(entry!=null&&entry.Length==f.Bytes,"inventory-mismatch");using(var stream=entry.Open())Format.Require(HashBounded(stream,f.Bytes)==f.Hash,"content-hash-mismatch");}return release;
    }
    internal static string HashBounded(Stream stream,long limit){using(var sha=SHA256.Create()){var chunk=new byte[65536];long total=0;int read;while((read=stream.Read(chunk,0,chunk.Length))>0){total+=read;Format.Require(total<=limit,"content-limit");sha.TransformBlock(chunk,0,read,chunk,0);}sha.TransformFinalBlock(new byte[0],0,0);Format.Require(total==limit,"content-length-mismatch");return Format.Hex(sha.Hash);}}
    internal static VerifiedFiles Directory(string root) {
      var verified=new VerifiedFiles();try {
        verified.Held.Add(SafeFiles.HoldDirectory(root));var manifest=SafeFiles.Read(SafeFiles.Child(root,"release.json"));verified.Held.Add(manifest);verified.Release=Envelope(Format.Read(manifest,65536));
        var expected=new HashSet<string>(verified.Release.Files.Select(f=>f.Path),StringComparer.Ordinal);expected.Add("release.json");var found=new HashSet<string>(StringComparer.Ordinal);int entries=0;
        Action<string,int> visit=null;visit=(relative,depth)=>{Format.Require(depth<=20,"tree-limit");var dir=relative==""?root:SafeFiles.Child(root,relative);foreach(var name in System.IO.Directory.GetFileSystemEntries(dir)){Format.Require(++entries<=1024,"tree-limit");var rel=relative==""?System.IO.Path.GetFileName(name):relative+"/"+System.IO.Path.GetFileName(name);Format.Relative(rel);var attrs=File.GetAttributes(name);Format.Require((attrs&FileAttributes.ReparsePoint)==0,"unsafe-link");if((attrs&FileAttributes.Directory)!=0){Format.Require(expected.Any(f=>f.StartsWith(rel+"/",StringComparison.Ordinal)),"extra-directory");verified.Held.Add(SafeFiles.HoldDirectory(name));visit(rel,depth+1);}else Format.Require(expected.Contains(rel)&&found.Add(rel),"extra-file");}};visit("",0);
        Format.Require(found.SetEquals(expected),"inventory-mismatch");foreach(var f in verified.Release.Files){var file=SafeFiles.Read(SafeFiles.Child(root,f.Path));verified.Held.Add(file);Format.Require(file.Length==f.Bytes&&Format.Hash(file)==f.Hash,"content-hash-mismatch");}return verified;
      }catch{verified.Dispose();throw;}
    }
  }
}
