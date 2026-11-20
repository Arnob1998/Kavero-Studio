// Test-only executable; never included in DESKTOP_SOURCES or the installer.
using System;
using System.IO;
using System.IO.Compression;
namespace Kavero.Connect {
 class VerifierHarness {
  static int Main(string[] args){
   AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
   try {
    if(args[0]=="envelope")TrustedPackage.Envelope(File.ReadAllBytes(args[1]));
    else if(args[0]=="archive")using(var stream=File.OpenRead(args[1]))using(var zip=new ZipArchive(stream,ZipArchiveMode.Read))TrustedPackage.Archive(zip);
    else if(args[0]=="directory")using(var held=TrustedPackage.Directory(args[1])){}
    else return 3;
    Console.WriteLine("accepted");return 0;
   }catch(Exception error){Console.Error.WriteLine(error is InvalidDataException?error.Message:"verification-failed");return 2;}
  }
 }
}
