"use strict";

process.chdir("../..");

const gulp     = require("gulp");
const plumber  = require("gulp-plumber");
const rename   = require("gulp-rename");
const through  = require("through2");
const forward  = require("undertaker-forward-reference");
const Vinyl    = require("vinyl");


// Enable forward referenced tasks. 
gulp.registry(forward());


// Create gulp tasks.
function glupost( configuration ){

   const tasks = configuration.tasks || {};
   const template = configuration.template || {};

   // Expand template object with defaults.
   expand(template, { transforms: [], dest: "." });

   // Create tasks.
   const names = Object.keys(tasks);
   for( const name of names ){

      // Expand task with template.
      const task = tasks[name];
      expand(task, template);

      gulp.task(name, compose(task));
   }

   // Create the watch task if declared and triggered.
   if( names.every(name => !tasks[name].watch) )
      return;

   const tracked = track(tasks);
   const paths = Object.keys(tracked);
   if( !paths.length )
      return;

   if( names.includes("watch") ){
      console.warn("`watch` task redefined.");
      return;
   }


   gulp.task("watch", function(){
      for( const path of paths ){
         const names = tracked[path];
         const watcher = gulp.watch(path, gulp.parallel(names));
         watcher.on("change", path => console.log(`${timestamp()} '${path}' was changed, running [${names.join(",")}]...`));
      }
   });

}


// Convert task object to a function.
function compose( task ){

   if( typeof task === "string" )
      return gulp.task(task);

   if( typeof task === "function" )
      return task;

   if( typeof task !== "object" )
      throw new Error("A task must be a string, function, or object.");

   const action = task.src ? () => pipify(task) : undefined;

   if( !action && !task.series && !task.parallel )
      throw new Error("A task must do something.");

   if( !task.series && !task.parallel )
      return action;

   if( task.series && task.parallel )
      throw new Error("A task can't have both .series and .parallel properties.");

   const type = task.series ? "series" : "parallel";

   if( action )
      task[type].push(action);

   return gulp[type]( ...task[type].map(compose) );

}


// Convert transform functions to a Stream.
function pipify( task ){

   const options = task.base ? { base: task.base } : {};

   let stream = gulp.src(task.src, options);

   if( task.watch )
      stream = stream.pipe(plumber( message => { console.log(message); this.emit("end") } ));

   for( const transform of task.transforms )
      stream = stream.pipe(pluginate(transform));

   if( task.rename )
      stream = stream.pipe(rename(task.rename));

   if( task.dest )
      stream = stream.pipe(gulp.dest(task.dest));

   return stream;

}


// Convert a string transform function into a stream.
function pluginate( transform ){

   return through.obj(function(file, encoding, done){

      // Nothing to transform.
      if( file.isNull() ){
         done(null, file);
         return;
      }

      // Transform function returns a vinyl file or file contents (in form of a
      // stream, a buffer or a string), or a promise which resolves with those.
      const result = transform( file.contents, file );
      Promise.resolve(result).then(function(result){
         if( !Vinyl.isVinyl(result) ){
            if( result instanceof Buffer )
               file.contents = result;
            else if( typeof result === "string" )
               file.contents = Buffer.from(result);
            else
               throw new Error("Transforms must return/resolve with a file, a buffer or a string.");
         }
         done(null, file);
      }).catch(function(error){
         throw new Error(error);
      });
      
   });

}


// Store watched paths and their tasks.
function track( tasks ){
   
   const tracked = {};

   const names = Object.keys(tasks);
   for( const name of names ){
      const task = tasks[name];
      if( !task.watch )
         continue;

      if( task.watch === true )
         task.watch = task.src;

      const paths = [].concat(task.watch);
      for( const path of paths ){
         if( !tracked[path] )
            tracked[path] = [];
         tracked[path].push(name);
      }
   }

   return tracked;

}


// Add new properties on `from` to `to`.
function expand( to, from ){
   
   const keys = Object.keys(from);
   for( const key of keys ){
      if( !to.hasOwnProperty(key) )
         to[key] = from[key];
   }

}


function timestamp(){

   const time    = new Date();
   const hours   = ("0" + time.getHours()).slice(-2);
   const minutes = ("0" + time.getMinutes()).slice(-2);
   const seconds = ("0" + time.getSeconds()).slice(-2);
   return `[${hours}:${minutes}:${seconds}]`;

}


module.exports = glupost;