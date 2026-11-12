/**
 * Base class of the trigger handlers. It knows no object.
 */
public virtual with sharing class TriggerHandler {
    public void run() {
        if (Trigger.isBefore && Trigger.isInsert) {
            beforeInsert(Trigger.new);
        } else if (Trigger.isBefore && Trigger.isUpdate) {
            beforeUpdate(Trigger.new, Trigger.oldMap);
        } else if (Trigger.isAfter && Trigger.isUpdate) {
            afterUpdate(Trigger.new, Trigger.oldMap);
        }
    }

    protected virtual void beforeInsert(List<SObject> records) {}

    protected virtual void beforeUpdate(List<SObject> records, Map<Id, SObject> oldRecords) {}

    protected virtual void afterUpdate(List<SObject> records, Map<Id, SObject> oldRecords) {}
}
