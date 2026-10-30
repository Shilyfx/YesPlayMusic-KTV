export default function createCatalogPrefetchScheduler({
  isHidden = () => false,
  shouldRun = () => true,
} = {}) {
  let queue = [];
  let activeTask = null;
  let foregroundLoads = 0;
  let stopped = false;
  let pumpTimer = null;

  const isAllowed = () => !stopped && shouldRun();

  const pump = () => {
    if (
      !isAllowed() ||
      isHidden() ||
      activeTask ||
      foregroundLoads ||
      !queue.length
    )
      return;

    const task = queue.shift();
    activeTask = task;
    let result;
    try {
      result = task.run();
    } catch (error) {
      result = Promise.reject(error);
    }

    Promise.resolve(result)
      .catch(() => {})
      .finally(() => {
        activeTask = null;
        schedulePump();
      });
  };

  const schedulePump = () => {
    if (pumpTimer !== null || !isAllowed()) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, 0);
  };

  const enqueue = tasks => {
    if (!isAllowed() || !Array.isArray(tasks)) return;
    tasks.forEach(task => {
      if (!task || task.key == null || typeof task.run !== 'function') return;
      if (activeTask?.key === task.key) return;
      if (queue.some(queuedTask => queuedTask.key === task.key)) return;
      queue.push(task);
    });
    schedulePump();
  };

  const runPriority = (key, run) => {
    queue = queue.filter(task => task.key !== key);
    if (!isAllowed() || typeof run !== 'function') return Promise.resolve();

    foregroundLoads += 1;
    const finish = () => {
      foregroundLoads = Math.max(0, foregroundLoads - 1);
      schedulePump();
    };

    let result;
    try {
      result = run();
    } catch (error) {
      finish();
      return Promise.reject(error);
    }
    Promise.resolve(result).then(finish, finish);
    return result;
  };

  const resume = () => {
    if (isAllowed()) schedulePump();
  };

  const stop = () => {
    stopped = true;
    queue = [];
    activeTask = null;
    if (pumpTimer !== null) {
      clearTimeout(pumpTimer);
      pumpTimer = null;
    }
  };

  return { enqueue, runPriority, resume, stop };
}
