using System;
using System.IO;
using System.IO.Compression;
class Pack {
 static int Main(string[] args){
  var root=Path.GetFullPath(args[0]).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
  using(var output=new FileStream(args[1],FileMode.CreateNew))using(var zip=new ZipArchive(output,ZipArchiveMode.Create)){
   var files=Directory.GetFiles(root,"*",SearchOption.AllDirectories);Array.Sort(files,StringComparer.Ordinal);
   foreach(var file in files){var name=file.Substring(root.Length).Replace('\\','/');var entry=zip.CreateEntry(name,CompressionLevel.Optimal);entry.LastWriteTime=new DateTimeOffset(2026,1,1,0,0,0,TimeSpan.Zero);using(var source=File.OpenRead(file))using(var target=entry.Open())source.CopyTo(target);}
  }return 0;
 }
}
