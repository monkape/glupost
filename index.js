"use strict"

let gulp = require("gulp")
let rename = require("gulp-rename")
let through = require("through2")
let Vinyl = require("vinyl")


module.exports = glupost


// Create gulp tasks.
function glupost({tasks={}, template={}}, {register=false} = {}) {

   // Expand template object with defaults.
   expand(template, {transforms: [], dest: "."})

   // Replace tasks with normalised objects.
   let entries = Object.entries(tasks)
   for (let [name, task] of entries)
      tasks[name] = init(task, template)

   // Create watch task (after other tasks are initialised).
   let watch_task = create_watch_task(tasks)
   if (watch_task)
      tasks["watch"] = init(watch_task)

   // Compose gulp tasks (after watch task is ready).
   let gulp_tasks = {}
   entries = Object.entries(tasks)
   for (let [name, task] of entries)
      gulp_tasks[name] = compose(task, tasks)

   if (register) {
      entries = Object.entries(gulp_tasks)
      for (let [name, task] of entries)
         gulp.task(name, task)
   }

   return gulp_tasks
}


// Recursively validate and normalise task and its properties, add wrappers around
// strings and functions, and return the (wrapped) task.
function init(task, template) {
   validate(task)

   // 1. named task.
   if (typeof task === "string") {
      return {alias: task}
   }

   // 2. a function directly.
   if (typeof task === "function") {
      return {callback: task}
   }

   // 3. task object.
   if (typeof task === "object") {
      expand(task, template)
      if (task.watch === true)
         task.watch = task.src

      if (task.task)
         task.task = init(task.task, template)
      else if (task.series)
         task.series = task.series.map((task) => init(task, template))
      else if (task.parallel)
         task.parallel = task.parallel.map((task) => init(task, template))

      return task
   }
}


// Recursively compose task's action and return it.
function compose(task, tasks, aliases=new Set()) {
   if (task.action)
      return task.action

   let action

   if (task.alias) {
      let name = task.alias
      let aliased_task = tasks[name]

      if (!aliased_task)
         throw new Error("Task never defined: " + name + ".")
      if (aliases.has(name))
         throw new Error("Circular aliases.")

      aliases.add(name)
      action = compose(aliased_task, tasks, aliases)
   }

   else if (task.callback) {
      let f = task.callback
      action = f.length ? f : async () => f()
   }

   else if (task.src) {
      action = () => streamify(task)
   }

   else if (task.task) {
      action = compose(task.task, tasks, aliases)
   }

   else if (task.series) {
      let subtasks = task.series.map((task) => compose(task, tasks, aliases))
      action = gulp.series(...subtasks)
   }

   else if (task.parallel) {
      let subtasks = task.parallel.map((task) => compose(task, tasks, aliases))
      action = gulp.parallel(...subtasks)
   }
   else {
      throw new Error("Invalid task structure.")       // Not expected.
   }

   task.action = action

   return action
}


// Check if task is valid.
function validate(task) {
   if (typeof task !== "object" && typeof task !== "string" && typeof task !== "function")
      throw new Error("A task must be a string, function, or object.")

   if (typeof task === "object") {
      // No transform function and no task/series/parallel.
      if (!task.src && !(task.task || task.series || task.parallel))
         throw new Error("A task must do something.")

      // Transform function and task/series/parallel.
      if (task.src && (task.task || task.series || task.parallel))
         throw new Error("A task can't have both .src and .task/.series/.parallel properties.")

      // Combining task/series/parallel.
      if (task.hasOwnProperty("task") + task.hasOwnProperty("series") + task.hasOwnProperty("parallel") > 1)
         throw new Error("A task can only have one of .task/.series/.parallel properties.")

      // Invalid .src.
      if (task.src && !(typeof task.src === "string" || task.src instanceof Vinyl))
         throw new Error("Task's .src must be a string or a Vinyl file.")

      // Invalid watch path.
      if (task.watch === true && !task.src)
         throw new Error("No path given to watch.")
   }
}


// Generate a watch task based on .watch property of other tasks.
function create_watch_task(tasks) {
   if (tasks["watch"]) {
      console.warn(timestamp() + "'watch' task redefined.")
      return null
   }

   let watched = Object.values(tasks).filter(({watch}) => watch)

   if (!watched.length)
      return null

   return () => {
      for (let {watch, action} of tasks) {
         let watcher = gulp.watch(watch, {delay: 0}, action)
         watcher.on("change", (path) => console.log(timestamp() + " " + path + " was changed, running tasks..."))
      }
   }
}


// Convert task's transform functions to a Stream.
function streamify(task) {
   let stream

   if (typeof task.src === "string") {
      let options = task.base ? {base: task.base} : {}
      stream = gulp.src(task.src, options)
   }
   else {
      stream = through.obj((file, encoding, done) => done(null, file))
      stream.end(task.src)
   }

   for (let transform of task.transforms)
      stream = stream.pipe(transform.pipe ? transform : pluginate(transform))

   if (task.rename)
      stream = stream.pipe(rename(task.rename))

   if (task.dest)
      stream = stream.pipe(gulp.dest(task.dest))

   return stream
}


// Convert a transform function into a Stream.
function pluginate(transform) {
   return through.obj((file, encoding, done) => {

      // Nothing to transform.
      if (file.isNull()) {
         done(null, file)
         return
      }

      // Transform function returns a vinyl file or file contents (in form of a
      // stream, a buffer or a string), or a promise which resolves with those.
      new Promise((resolve) => {
         resolve(transform(file.contents, file))
      }).then((result) => {
         if (!Vinyl.isVinyl(result)) {
            if (result instanceof Buffer)
               file.contents = result
            else if (typeof result === "string")
               file.contents = Buffer.from(result)
            else
               throw new Error("Transforms must return/resolve with a file, a buffer or a string.")
         }
      }).then(() => {
         done(null, file)
      }).catch((e) => {
         done(e)
      })
   })
}


// Add new properties on 'from' to 'to'.
function expand(to, from) {
   let keys = Object.keys(from)
   for (let key of keys) {
      if (!to.hasOwnProperty(key))
         to[key] = from[key]
   }
}


// Output current time in '[HH:MM:SS]' format.
function timestamp() {
   return "[" + new Date().toLocaleTimeString("hr-HR") + "]"
}
