/**
 * An action a flow can call with a record of any object. The flow says which object its records are of.
 */
public with sharing class RecordObjectAction {
    @InvocableVariable(label='Record' required=true)
    public SObject record;

    @InvocableMethod(label='Name the Object' description='Gives back the name of the object of each record.')
    public static List<String> objectOf(List<RecordObjectAction> requests) {
        List<String> names = new List<String>();
        for (RecordObjectAction request : requests) {
            names.add(String.valueOf(request.record.getSObjectType()));
        }
        return names;
    }
}
